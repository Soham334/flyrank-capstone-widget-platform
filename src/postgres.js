// Hosted persistence. Local mode continues to use the native SQLite repository.
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { now, widget, submission } from './database.js';

export async function openPostgres(connectionString) {
  const {default:pg}=await import('pg');
  const pool=new pg.Pool({connectionString,max:5,connectionTimeoutMillis:15000,idleTimeoutMillis:10000,query_timeout:15000});
  pool.on('error',()=>console.error(JSON.stringify({event:'database.connection_error'})));
  const query=async(sql,args=[],client=pool)=>{
    const result=await client.query(sql,args);
    for(const row of result.rows)for(const key of ['count','leads','value'])if(typeof row[key]==='string'&&/^\d+$/.test(row[key]))row[key]=Number(row[key]);
    return result;
  };
  const all=async(sql,args=[],client)=> (await query(sql,args,client)).rows;
  const one=async(sql,args=[],client)=> (await all(sql,args,client))[0];
  const atomic=async fn=>{const c=await pool.connect();try{await c.query('BEGIN');const result=await fn(c);await c.query('COMMIT');return result;}catch(error){await c.query('ROLLBACK');throw error;}finally{c.release();}};
  try {
    await atomic(async c=>{
      await c.query('SELECT pg_advisory_xact_lock(19184101)');
      await c.query('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)');
      if(!await one('SELECT version FROM schema_migrations WHERE version=1',[],c)){
        await c.query(readFileSync(new URL('../migrations/postgres/001_initial.sql',import.meta.url),'utf8'));
        await c.query('INSERT INTO schema_migrations VALUES (1,$1)',[now()]);
      }
    });
  }catch(error){await pool.end();throw error;}
  const audit=(c,tenant,action,id)=>query('INSERT INTO audit_events VALUES ($1,$2,$3,$4,$5)',[randomUUID(),tenant,action,id,now()],c);
  const repo={
    healthy:async()=> (await one('SELECT 1 value')).value===1,
    userByEmail:email=>one('SELECT * FROM tenants WHERE email=$1',[email]),
    createUser:(u,password)=>query('INSERT INTO tenants VALUES ($1,$2,$3,$4,$5)',[u.id,u.name,u.email,password,now()]),
    sessionUser:token=>one('SELECT t.id,t.name,t.email FROM sessions s JOIN tenants t ON t.id=s.tenant_id WHERE s.token_hash=$1 AND s.expires_at>$2',[token,Date.now()]),
    createSession:(token,tenant,expiry)=>atomic(async c=>{await query('DELETE FROM sessions WHERE expires_at<=$1',[Date.now()],c);await query('INSERT INTO sessions VALUES ($1,$2,$3)',[token,tenant,expiry],c);}),
    deleteSession:token=>query('DELETE FROM sessions WHERE token_hash=$1',[token]),
    ownerWidget:async(id,tenant)=>widget(await one('SELECT * FROM widgets WHERE id=$1 AND tenant_id=$2',[id,tenant])),
    publicWidget:async id=>widget(await one('SELECT * FROM widgets WHERE id=$1 AND active=1',[id])),
    widgets:async tenant=>(await all('SELECT w.*, (SELECT count(*) FROM submissions s WHERE s.widget_id=w.id AND s.tenant_id=$1) leads FROM widgets w WHERE w.tenant_id=$1 ORDER BY w.created_at DESC',[tenant])).map(widget),
    createWidget:async(tenant,b)=>{
      const id=randomUUID(),time=now();await atomic(async c=>{
        await query('INSERT INTO widgets VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)',[id,tenant,b.name,b.type,b.title,b.description,b.button_text,b.color,JSON.stringify(b.fields),Number(b.active),JSON.stringify(b.targeting),time,time],c);
        await audit(c,tenant,'widget.created',id);
      });return id;
    },
    updateWidget:(id,tenant,b)=>atomic(async c=>{await query('UPDATE widgets SET name=$1,type=$2,title=$3,description=$4,button_text=$5,color=$6,fields=$7,active=$8,targeting=$9,updated_at=$10 WHERE id=$11 AND tenant_id=$12',[b.name,b.type,b.title,b.description,b.button_text,b.color,JSON.stringify(b.fields),Number(b.active),JSON.stringify(b.targeting),now(),id,tenant],c);await audit(c,tenant,'widget.updated',id);}),
    deleteWidget:(id,tenant)=>atomic(async c=>{await query('DELETE FROM widgets WHERE id=$1 AND tenant_id=$2',[id,tenant],c);await audit(c,tenant,'widget.deleted',id);}),
    idempotentLead:(id,key)=>one('SELECT * FROM submissions WHERE widget_id=$1 AND idempotency_key=$2',[id,key]),
    storeLead:({id,widgetId,tenantId,data,geo,source,consentText,key,fingerprint})=>atomic(async c=>{
      const time=now();await query('INSERT INTO submissions (id,widget_id,tenant_id,data,geo,source,consent,consent_text,created_at,idempotency_key,payload_hash) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',[id,widgetId,tenantId,JSON.stringify(data),geo?JSON.stringify(geo):null,source,1,consentText,time,key,fingerprint],c);
      await query('INSERT INTO jobs (id,tenant_id,submission_id,available_at,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6)',[randomUUID(),tenantId,id,Date.now(),time,time],c);
    }),
    dashboard:async tenant=>{
      const [total,today,active,enriched,timeseries,countries,per_widget,jobs]=await Promise.all([
        one('SELECT count(*) value FROM submissions WHERE tenant_id=$1',[tenant]),
        one('SELECT count(*) value FROM submissions WHERE tenant_id=$1 AND created_at>=$2',[tenant,new Date().toISOString().slice(0,10)]),
        one('SELECT count(*) value FROM widgets WHERE tenant_id=$1 AND active=1',[tenant]),
        one('SELECT count(*) value FROM submissions WHERE tenant_id=$1 AND geo IS NOT NULL',[tenant]),
        all('SELECT substr(created_at,1,10) day,count(*) count FROM submissions WHERE tenant_id=$1 AND created_at>=$2 GROUP BY day ORDER BY day',[tenant,new Date(Date.now()-29*86400000).toISOString().slice(0,10)]),
        all("SELECT coalesce(geo::jsonb->>'country','Unknown') country,count(*) count FROM submissions WHERE tenant_id=$1 GROUP BY country ORDER BY count DESC",[tenant]),
        all('SELECT w.id,w.name,count(s.id) count FROM widgets w LEFT JOIN submissions s ON w.id=s.widget_id AND s.tenant_id=w.tenant_id WHERE w.tenant_id=$1 GROUP BY w.id ORDER BY count DESC',[tenant]),
        all('SELECT status,count(*) count FROM jobs WHERE tenant_id=$1 GROUP BY status',[tenant]),
      ]);return {total:total.value,today:today.value,active:active.value,enriched:enriched.value,timeseries,countries,per_widget,jobs};
    },
    leads:async(tenant,{filter,status,q,page,size,exporting})=>{
      const where="s.tenant_id=$1 AND ($2::text IS NULL OR s.widget_id=$2) AND ($3::text IS NULL OR s.status=$3) AND ($4='' OR strpos(lower(s.data),lower($4))>0)";
      const args=[tenant,filter,status,q];
      const [items,total]=await Promise.all([all(`SELECT s.*,w.name widget_name FROM submissions s JOIN widgets w ON w.id=s.widget_id WHERE ${where} ORDER BY s.created_at DESC LIMIT $5 OFFSET $6`,[...args,exporting?10000:size,exporting?0:(page-1)*size]),one(`SELECT count(*) value FROM submissions s WHERE ${where}`,args)]);
      return {items:items.map(submission),total:total.value,page,limit:size};
    },
    lead:async(id,tenant)=>submission(await one('SELECT * FROM submissions WHERE id=$1 AND tenant_id=$2',[id,tenant])),
    updateLead:(id,tenant,status)=>atomic(async c=>{await query('UPDATE submissions SET status=$1 WHERE id=$2 AND tenant_id=$3',[status,id,tenant],c);await audit(c,tenant,'lead.'+status,id);}),
    deleteLead:(id,tenant)=>atomic(async c=>{await query('DELETE FROM submissions WHERE id=$1 AND tenant_id=$2',[id,tenant],c);await audit(c,tenant,'lead.deleted',id);}),
    jobs:tenant=>all('SELECT * FROM jobs WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 100',[tenant]),
    retryJob:(id,tenant)=>atomic(async c=>{const r=await query("UPDATE jobs SET status='pending',attempts=0,available_at=$1,updated_at=$2 WHERE id=$3 AND tenant_id=$4 AND status='dead'",[Date.now(),now(),id,tenant],c);if(r.rowCount)await audit(c,tenant,'job.retried',id);return Boolean(r.rowCount);}),
    audit:tenant=>all('SELECT * FROM audit_events WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 100',[tenant]),
  };
  // The shared single-process worker uses a tiny parameterized statement interface.
  const database={
    prepare(sql){let n=0;const pgSql=sql.replace(/\?/g,()=>`$${++n}`);return {
      all:(...args)=>all(pgSql,args),get:(...args)=>one(pgSql,args),
      run:async(...args)=>({changes:(await query(pgSql,args)).rowCount}),
    };},
    close:()=>pool.end(),
  };
  return {database,repository:repo,atomic,query};
}
