import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app.js';
import { publicIp } from '../src/enrichment.js';
import { repository } from '../src/repository.js';
import { validateWidget } from '../src/security.js';

const quiet={info(){},error(){}};
async function fixture(t,overrides={},deps={}){
  const dir=mkdtempSync(path.join(tmpdir(),'relay-test-'));
  const app=createApp({databasePath:path.join(dir,'test.sqlite'),jobInterval:3600000,rateIp:1000,rateWidget:1000,...overrides},{log:quiet,...deps});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${app.server.address().port}`;
  t.after(async()=>{await app.close();rmSync(dir,{recursive:true,force:true});});
  async function req(url,{method='GET',body,cookie,headers={}}={}){
    const r=await fetch(base+url,{method,headers:{...(body!==undefined?{'Content-Type':'application/json'}:{}),...(cookie?{Cookie:cookie}:{}),...headers},...(body!==undefined?{body:typeof body==='string'?body:JSON.stringify(body)}:{})});
    const raw=await r.text();let data;try{data=JSON.parse(raw);}catch{data=raw;}
    return {status:r.status,headers:r.headers,data,raw};
  }
  const register=async(email='owner@example.com')=>{const r=await req('/api/auth/register',{method:'POST',body:{name:'Test Studio',email,password:'A-strong-password-2026'}});assert.equal(r.status,201);return r.headers.get('set-cookie').split(';')[0];};
  const create=async cookie=>{const r=await req('/api/widgets',{method:'POST',cookie,body:{name:'Newsletter',title:'Join our community'}});assert.equal(r.status,201);return r.data;};
  const lead=(id,extra={})=>({widget_id:id,data:{name:'Ada Lovelace',email:'ada@example.com'},consent:true,website:'',source:'http://localhost:5500/article?private=secret#fragment',...extra});
  return {app,base,req,register,create,lead};
}
test('auth: registration, login, hashed sessions, CSRF, logout, and missing credentials',async t=>{
  const {app,req,register}=await fixture(t);assert.equal((await req('/api/widgets')).status,401);
  const cookie=await register();assert.equal((await req('/api/auth/me',{cookie})).data.email,'owner@example.com');
  const tenant=app.db.prepare('SELECT * FROM tenants').get();assert.notEqual(tenant.password_hash,'A-strong-password-2026');
  assert.ok(!cookie.includes(app.db.prepare('SELECT token_hash FROM sessions').get().token_hash));
  assert.equal((await req('/api/widgets',{method:'POST',cookie,headers:{Origin:'https://attacker.example'},body:{name:'x',title:'x'}})).status,403);
  assert.equal((await req('/api/auth/login',{method:'POST',body:{email:'owner@example.com',password:'incorrect-password'}})).status,401);
  assert.equal((await req('/api/auth/login',{method:'POST',body:{email:'owner@example.com',password:'A-strong-password-2026'}})).status,200);
  await req('/api/auth/logout',{method:'POST',cookie});assert.equal((await req('/api/auth/me',{cookie})).status,401);
});
test('widget CRUD, validation, generated snippet, versioned cache and conditional config',async t=>{
  const {req,register,create}=await fixture(t);const cookie=await register(),w=await create(cookie);
  assert.equal((await req('/api/widgets/'+w.id,{cookie})).status,200);
  const snippet=await req(`/api/widgets/${w.id}/snippet`,{cookie});assert.ok(snippet.data.snippet.includes(`/widget.v1.js?id=${w.id}`));
  const bundle=await req('/widget.v1.js');assert.equal(bundle.status,200);assert.match(bundle.headers.get('cache-control'),/31536000, immutable/);
  const c=await req(`/api/widgets/${w.id}/config`);assert.equal(c.data.tenant_id,undefined);assert.match(c.headers.get('cache-control'),/max-age=30/);
  assert.equal((await req(`/api/widgets/${w.id}/config`,{headers:{'If-None-Match':c.headers.get('etag')}})).status,304);
  assert.equal((await req('/api/widgets/'+w.id,{method:'PATCH',cookie,body:{title:'Updated'}})).data.title,'Updated');
  assert.equal((await req('/api/widgets/'+w.id,{method:'PATCH',cookie,body:{color:'red;position:fixed'}})).status,422);
  assert.equal((await req('/api/widgets/'+w.id,{method:'DELETE',cookie})).status,204);
  assert.equal((await req('/api/widgets/'+w.id,{cookie})).status,404);
});
test('tenant isolation covers widget reads, updates, deletes, snippets, leads, jobs, exports and analytics',async t=>{
  const {app,req,register,create,lead}=await fixture(t);const a=await register(),b=await register('other@example.com'),w=await create(a);
  const s=await req('/api/submissions',{method:'POST',body:lead(w.id)});assert.equal(s.status,201);
  for(const suffix of ['', '/snippet'])assert.equal((await req('/api/widgets/'+w.id+suffix,{cookie:b})).status,404);
  for(const method of ['PATCH','DELETE'])assert.equal((await req('/api/widgets/'+w.id,{cookie:b,method,body:method==='PATCH'?{title:'stolen'}:undefined})).status,404);
  for(const method of ['GET','PATCH','DELETE'])assert.equal((await req('/api/leads/'+s.data.id,{cookie:b,method,body:method==='PATCH'?{status:'archived'}:undefined})).status,404);
  assert.equal((await req('/api/leads',{cookie:b})).data.total,0);assert.equal((await req('/api/dashboard',{cookie:b})).data.total,0);
  assert.equal((await req('/api/jobs',{cookie:b})).data.items.length,0);assert.ok(!(await req('/api/leads/export',{cookie:b})).raw.includes('ada@example.com'));
  const job=app.db.prepare('SELECT id FROM jobs').get();assert.equal((await req(`/api/jobs/${job.id}/retry`,{method:'POST',cookie:b})).status,404);
});
test('public CORS preflight and cross-origin submission store a linked, consented, enriched row',async t=>{
  const {req,register,create,lead}=await fixture(t);const cookie=await register(),w=await create(cookie);
  const preflight=await req('/api/submissions',{method:'OPTIONS',headers:{Origin:'http://localhost:5500','Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'content-type,idempotency-key'}});
  assert.equal(preflight.status,204);assert.equal(preflight.headers.get('access-control-allow-origin'),'*');assert.match(preflight.headers.get('access-control-allow-headers'),/Idempotency-Key/);
  const s=await req('/api/submissions',{method:'POST',headers:{Origin:'http://localhost:5500'},body:lead(w.id)});assert.equal(s.status,201);assert.equal(s.data.geo.provider,'mock-a');
  const r=await req('/api/leads/'+s.data.id,{cookie});assert.equal(r.data.widget_id,w.id);assert.equal(r.data.consent,true);assert.ok(r.data.consent_text);assert.equal(r.data.source,'http://localhost:5500/article');
});
test('malformed, oversized, invalid content type and invalid fields return clean 4xx JSON',async t=>{
  const {req,register,create,lead}=await fixture(t);const cookie=await register(),w=await create(cookie);
  for(const [body,status,headers]of [['{bad',400,{}],['{"x":"'+'x'.repeat(20000)+'"}',413,{}],[lead(w.id,{consent:false}),422,{}],[lead(w.id,{data:{email:'bad',name:'Ada'}}),422,{}],[lead(w.id,{extra:'unknown'}),422,{}],[{},415,{'Content-Type':'text/plain'}]]){
    const r=await req('/api/submissions',{method:'POST',body,headers});assert.equal(r.status,status);assert.equal(typeof r.data.error,'string');assert.ok(r.data.request_id);
  }
});
test('honeypot rejects spam without storing a lead or notification',async t=>{
  const {app,req,register,create,lead}=await fixture(t);const w=await create(await register());
  assert.equal((await req('/api/submissions',{method:'POST',body:lead(w.id,{website:'https://spam.invalid'})})).status,422);
  assert.equal(app.db.prepare('SELECT count(*) n FROM submissions').get().n,0);assert.equal(app.db.prepare('SELECT count(*) n FROM jobs').get().n,0);
});
test('per-IP rate limiting returns 429 with Retry-After; health remains available; spoofed IP ignored',async t=>{
  const {req,register,create,lead}=await fixture(t,{rateIp:2});const w=await create(await register());
  for(let i=0;i<2;i++)assert.equal((await req('/api/submissions',{method:'POST',body:lead(w.id)})).status,201);
  const r=await req('/api/submissions',{method:'POST',headers:{'X-Forwarded-For':'8.8.8.8'},body:lead(w.id)});assert.equal(r.status,429);assert.ok(Number(r.headers.get('retry-after'))>0);assert.equal((await req('/health')).status,200);
});
test('per-widget rate limiting isolates burst traffic from a second widget',async t=>{
  const {req,register,create,lead}=await fixture(t,{rateWidget:1});const cookie=await register(),a=await create(cookie),b=await create(cookie);
  assert.equal((await req('/api/submissions',{method:'POST',body:lead(a.id)})).status,201);
  assert.equal((await req('/api/submissions',{method:'POST',body:lead(a.id)})).status,429);
  assert.equal((await req('/api/submissions',{method:'POST',body:lead(b.id)})).status,201);
});
test('provider A outage falls back to B; all geo providers down still stores lead',async t=>{
  const {app,req,register,create,lead}=await fixture(t,{geoADown:true});const w=await create(await register());
  const a=await req('/api/submissions',{method:'POST',body:lead(w.id)});assert.equal(a.status,201);assert.equal(a.data.geo.provider,'mock-b');
  app.config.geoBDown=true;const b=await req('/api/submissions',{method:'POST',body:lead(w.id)});assert.equal(b.status,201);assert.equal(b.data.geo,null);
  assert.equal(app.db.prepare('SELECT count(*) n FROM submissions').get().n,2);
});
test('idempotency deduplicates sequential and concurrent retries, and rejects changed payloads',async t=>{
  const {app,req,register,create,lead}=await fixture(t);const w=await create(await register()),headers={'Idempotency-Key':'stable-key-12345'};
  const rows=await Promise.all(Array.from({length:5},()=>req('/api/submissions',{method:'POST',headers,body:lead(w.id)})));
  assert.equal(new Set(rows.map(r=>r.data.id)).size,1);assert.equal(rows.filter(r=>r.status===201).length,1);assert.equal(app.db.prepare('SELECT count(*) n FROM jobs').get().n,1);
  const r=await req('/api/submissions',{method:'POST',headers,body:lead(w.id)});assert.equal(r.status,200);assert.equal(r.headers.get('idempotency-replayed'),'true');
  assert.equal((await req('/api/submissions',{method:'POST',headers,body:lead(w.id,{data:{name:'Grace Hopper',email:'grace@example.com'}})})).status,409);
});
test('notification failure is off request path, retries persist, dead letter alerts and owner retry work',async t=>{
  const logs=[];const {app,req,register,create,lead}=await fixture(t,{notificationMode:'fail',jobMaxAttempts:2},{log:{info(){},error:v=>logs.push(v)}});
  const cookie=await register(),w=await create(cookie);assert.equal((await req('/api/submissions',{method:'POST',body:lead(w.id)})).status,201);
  await app.worker.tick();let job=app.db.prepare('SELECT * FROM jobs').get();assert.equal(job.status,'pending');assert.equal(job.attempts,1);assert.ok(job.available_at>Date.now());
  app.db.prepare('UPDATE jobs SET available_at=0').run();await app.worker.tick();job=app.db.prepare('SELECT * FROM jobs').get();assert.equal(job.status,'dead');assert.ok(logs.some(s=>s.includes('notification.dead_letter')));
  assert.equal((await req('/api/leads',{cookie})).data.total,1);
  assert.equal((await req(`/api/jobs/${job.id}/retry`,{method:'POST',cookie})).status,200);app.config.notificationMode='console';await app.worker.tick();assert.equal(app.db.prepare('SELECT status FROM jobs').get().status,'delivered');
});
test('dashboard aggregations, search, pagination, status update, consent export and data deletion',async t=>{
  const {req,register,create,lead}=await fixture(t);const cookie=await register(),w=await create(cookie);
  const s=await req('/api/submissions',{method:'POST',body:lead(w.id)});const d=(await req('/api/dashboard',{cookie})).data;
  assert.equal(d.total,1);assert.equal(d.active,1);assert.equal(d.enriched,1);assert.equal(d.countries[0].country,'India');assert.equal(d.per_widget[0].count,1);
  assert.equal((await req('/api/leads?q=Ada',{cookie})).data.total,1);assert.equal((await req('/api/leads?q=nobody',{cookie})).data.total,0);assert.equal((await req('/api/leads?page=-1',{cookie})).status,422);
  assert.equal((await req('/api/leads/'+s.data.id,{method:'PATCH',cookie,body:{status:'qualified'}})).status,200);
  assert.equal((await req('/api/leads?status=qualified',{cookie})).data.total,1);assert.ok((await req('/api/leads/export',{cookie})).raw.includes('ada@example.com'));
  await req('/api/leads/'+s.data.id,{method:'DELETE',cookie});assert.equal((await req('/api/leads',{cookie})).data.total,0);assert.equal((await req('/api/jobs',{cookie})).data.items.length,0);
});
test('CSV export neutralizes spreadsheet formula injection',async t=>{
  const {req,register,create,lead}=await fixture(t);const cookie=await register(),w=await create(cookie);
  await req('/api/submissions',{method:'POST',body:lead(w.id,{data:{name:'=HYPERLINK("https://evil.invalid")',email:'ada@example.com'}})});
  const r=await req('/api/leads/export',{cookie});assert.ok(r.raw.includes('"\'=HYPERLINK'));
});
test('paused widgets reject public submissions and public configuration',async t=>{
  const {req,register,create,lead}=await fixture(t);const cookie=await register(),w=await create(cookie);
  await req('/api/widgets/'+w.id,{method:'PATCH',cookie,body:{active:false}});
  assert.equal((await req(`/api/widgets/${w.id}/config`)).status,404);assert.equal((await req('/api/submissions',{method:'POST',body:lead(w.id)})).status,404);
});
test('raw forwarded headers cannot cause outbound lookups of private addresses',()=>{for(const ip of ['127.0.0.1','10.0.0.1','192.168.0.1','::1','::ffff:127.0.0.1','fe80::1','fc00::1'])assert.equal(publicIp(ip),false);assert.equal(publicIp('8.8.8.8'),true);});
test('persistence survives database reopen with sessions, submissions, and pending jobs',async t=>{
  const dir=mkdtempSync(path.join(tmpdir(),'relay-persist-')),filename=path.join(dir,'test.sqlite');
  const a=createApp({databasePath:filename,jobInterval:3600000},{log:quiet});
  a.db.prepare('INSERT INTO tenants VALUES (?,?,?,?,?)').run('tenant','Test','test@example.com','salt:hash',new Date().toISOString());
  a.db.prepare('INSERT INTO sessions VALUES (?,?,?)').run('token-hash','tenant',Date.now()+100000);
  const repo=repository(a.db),wid=repo.createWidget('tenant',validateWidget({name:'Persistent',title:'Persistent form'}));
  repo.storeLead({id:'persistent-lead',widgetId:wid,tenantId:'tenant',data:{name:'Ada',email:'ada@example.com'},geo:null,source:'',consentText:'Agreed',key:'persistent-key',fingerprint:'digest'});
  a.db.prepare("UPDATE jobs SET status='running',attempts=1").run();
  await a.close();const b=createApp({databasePath:filename,jobInterval:3600000},{log:quiet});
  try{
    assert.equal(b.db.prepare('SELECT name FROM tenants').get().name,'Test');assert.equal(b.db.prepare('SELECT count(*) n FROM sessions').get().n,1);assert.equal(b.db.prepare('SELECT count(*) n FROM schema_migrations').get().n,1);
    assert.equal(repository(b.db).lead('persistent-lead','tenant').data.email,'ada@example.com');
    const job=b.db.prepare('SELECT * FROM jobs').get();assert.equal(job.status,'pending');assert.equal(job.attempts,1);
    assert.equal(repository(b.db).idempotentLead(wid,'persistent-key').id,'persistent-lead');
  }finally{await b.close();rmSync(dir,{recursive:true,force:true});}
});
test('outbox failure rolls back the lead so acceptance and delivery intent cannot diverge',async t=>{
  const {app,req,register,create,lead}=await fixture(t);const w=await create(await register());
  app.db.exec("CREATE TEMP TRIGGER fail_job BEFORE INSERT ON jobs BEGIN SELECT RAISE(ABORT, 'simulated outbox failure'); END");
  const r=await req('/api/submissions',{method:'POST',body:lead(w.id)});assert.equal(r.status,500);assert.equal(r.data.error,'Internal server error.');
  assert.equal(app.db.prepare('SELECT count(*) n FROM submissions').get().n,0);assert.equal(app.db.prepare('SELECT count(*) n FROM jobs').get().n,0);
});
