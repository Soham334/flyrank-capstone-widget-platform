// Persistence boundary. Every owner-facing operation requires tenantId explicitly.
import { randomUUID } from 'node:crypto';
import { transaction, audit, now, widget, submission } from './database.js';

export function repository(db) {
  return {
    healthy: () => db.prepare('SELECT 1 value').get().value === 1,
    userByEmail: email => db.prepare('SELECT * FROM tenants WHERE email=?').get(email),
    createUser(user,password) { db.prepare('INSERT INTO tenants VALUES (?,?,?,?,?)').run(user.id,user.name,user.email,password,now()); },
    sessionUser: tokenHash => db.prepare('SELECT t.id,t.name,t.email FROM sessions s JOIN tenants t ON t.id=s.tenant_id WHERE s.token_hash=? AND s.expires_at>?').get(tokenHash,Date.now()),
    createSession(tokenHash,tenantId,expiry) { transaction(db,()=>{db.prepare('DELETE FROM sessions WHERE expires_at<=?').run(Date.now());db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(tokenHash,tenantId,expiry);}); },
    deleteSession(tokenHash) {db.prepare('DELETE FROM sessions WHERE token_hash=?').run(tokenHash);},
    ownerWidget: (id,tenantId) => widget(db.prepare('SELECT * FROM widgets WHERE id=? AND tenant_id=?').get(id,tenantId)),
    publicWidget: id => widget(db.prepare('SELECT * FROM widgets WHERE id=? AND active=1').get(id)),
    widgets: tenantId => db.prepare('SELECT w.*, (SELECT count(*) FROM submissions s WHERE s.widget_id=w.id AND s.tenant_id=?) leads FROM widgets w WHERE tenant_id=? ORDER BY created_at DESC').all(tenantId,tenantId).map(widget),
    createWidget(tenantId,b) {
      const id=randomUUID(),time=now();transaction(db,()=>{
        db.prepare('INSERT INTO widgets VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,tenantId,b.name,b.type,b.title,b.description,b.button_text,b.color,JSON.stringify(b.fields),Number(b.active),JSON.stringify(b.targeting),time,time);
        audit(db,tenantId,'widget.created',id);
      });return id;
    },
    updateWidget(id,tenantId,b) {transaction(db,()=>{
      db.prepare('UPDATE widgets SET name=?,type=?,title=?,description=?,button_text=?,color=?,fields=?,active=?,targeting=?,updated_at=? WHERE id=? AND tenant_id=?').run(b.name,b.type,b.title,b.description,b.button_text,b.color,JSON.stringify(b.fields),Number(b.active),JSON.stringify(b.targeting),now(),id,tenantId);
      audit(db,tenantId,'widget.updated',id);
    });},
    deleteWidget(id,tenantId) {transaction(db,()=>{db.prepare('DELETE FROM widgets WHERE id=? AND tenant_id=?').run(id,tenantId);audit(db,tenantId,'widget.deleted',id);});},
    idempotentLead: (widgetId,key) => db.prepare('SELECT * FROM submissions WHERE widget_id=? AND idempotency_key=?').get(widgetId,key),
    storeLead({id,widgetId,tenantId,data,geo,source,consentText,key,fingerprint}) {
      const time=now();transaction(db,()=>{
        db.prepare('INSERT INTO submissions (id,widget_id,tenant_id,data,geo,source,consent,consent_text,created_at,idempotency_key,payload_hash) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(id,widgetId,tenantId,JSON.stringify(data),geo?JSON.stringify(geo):null,source,1,consentText,time,key,fingerprint);
        // Transactional outbox: the lead and delivery intent either both commit or neither does.
        db.prepare('INSERT INTO jobs (id,tenant_id,submission_id,available_at,created_at,updated_at) VALUES (?,?,?,?,?,?)').run(randomUUID(),tenantId,id,Date.now(),time,time);
      });
    },
    dashboard(tenantId) {
      const total=db.prepare('SELECT count(*) value FROM submissions WHERE tenant_id=?').get(tenantId).value;
      const today=db.prepare('SELECT count(*) value FROM submissions WHERE tenant_id=? AND created_at>=?').get(tenantId,new Date().toISOString().slice(0,10)).value;
      const active=db.prepare('SELECT count(*) value FROM widgets WHERE tenant_id=? AND active=1').get(tenantId).value;
      const enriched=db.prepare('SELECT count(*) value FROM submissions WHERE tenant_id=? AND geo IS NOT NULL').get(tenantId).value;
      const timeseries=db.prepare('SELECT substr(created_at,1,10) day,count(*) count FROM submissions WHERE tenant_id=? AND created_at>=? GROUP BY day ORDER BY day').all(tenantId,new Date(Date.now()-29*86400000).toISOString().slice(0,10));
      const countries=db.prepare("SELECT coalesce(json_extract(geo,'$.country'),'Unknown') country,count(*) count FROM submissions WHERE tenant_id=? GROUP BY country ORDER BY count DESC").all(tenantId);
      const per_widget=db.prepare('SELECT w.id,w.name,count(s.id) count FROM widgets w LEFT JOIN submissions s ON w.id=s.widget_id AND s.tenant_id=w.tenant_id WHERE w.tenant_id=? GROUP BY w.id ORDER BY count DESC').all(tenantId);
      const jobs=db.prepare('SELECT status,count(*) count FROM jobs WHERE tenant_id=? GROUP BY status').all(tenantId);
      return {total,today,active,enriched,timeseries,countries,per_widget,jobs};
    },
    leads(tenantId,{filter,status,q,page,size,exporting}) {
      const where="s.tenant_id=? AND (? IS NULL OR s.widget_id=?) AND (? IS NULL OR s.status=?) AND (?='' OR instr(lower(s.data),lower(?))>0)";
      const args=[tenantId,filter,filter,status,status,q,q];
      const items=db.prepare(`SELECT s.*,w.name widget_name FROM submissions s JOIN widgets w ON w.id=s.widget_id WHERE ${where} ORDER BY s.created_at DESC LIMIT ? OFFSET ?`).all(...args,exporting?10000:size,exporting?0:(page-1)*size).map(submission);
      const total=db.prepare(`SELECT count(*) value FROM submissions s WHERE ${where}`).get(...args).value;
      return {items,total,page,limit:size};
    },
    lead: (id,tenantId) => submission(db.prepare('SELECT * FROM submissions WHERE id=? AND tenant_id=?').get(id,tenantId)),
    updateLead(id,tenantId,status) {transaction(db,()=>{db.prepare('UPDATE submissions SET status=? WHERE id=? AND tenant_id=?').run(status,id,tenantId);audit(db,tenantId,`lead.${status}`,id);});},
    deleteLead(id,tenantId) {transaction(db,()=>{db.prepare('DELETE FROM submissions WHERE id=? AND tenant_id=?').run(id,tenantId);audit(db,tenantId,'lead.deleted',id);});},
    jobs: tenantId => db.prepare('SELECT * FROM jobs WHERE tenant_id=? ORDER BY created_at DESC LIMIT 100').all(tenantId),
    retryJob(id,tenantId) {
      return transaction(db,()=>{const result=db.prepare("UPDATE jobs SET status='pending',attempts=0,available_at=?,updated_at=? WHERE id=? AND tenant_id=? AND status='dead'").run(Date.now(),now(),id,tenantId);if(result.changes)audit(db,tenantId,'job.retried',id);return Boolean(result.changes);});
    },
    audit: tenantId => db.prepare('SELECT * FROM audit_events WHERE tenant_id=? ORDER BY created_at DESC LIMIT 100').all(tenantId),
  };
}
