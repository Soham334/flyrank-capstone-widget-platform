import http from 'node:http';
import { readFileSync } from 'node:fs';
import { randomBytes, randomUUID } from 'node:crypto';
import { config as makeConfig } from './config.js';
import { openDatabase } from './database.js';
import { repository } from './repository.js';
import { HttpError, RateLimiter, hash, passwordHash, passwordMatches, jsonBody, text, onlyKeys, validateWidget, validateLead } from './security.js';
import { geoProviders, enrich } from './enrichment.js';
import { createWorker } from './jobs.js';

const assets = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']], ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']], ['/widget.v1.js', ['widget.v1.js', 'text/javascript; charset=utf-8']],
]);
const consentText = 'I agree to be contacted about my request.';
const stable = value => JSON.stringify(value, (key, val) => val && typeof val === 'object' && !Array.isArray(val) ? Object.fromEntries(Object.keys(val).sort().map(k => [k, val[k]])) : val);

export function createApp(overrides = {}, dependencies = {}) {
  const config = makeConfig(overrides);
  const db = dependencies.database || openDatabase(config.databasePath);
  const repo = dependencies.repository || repository(db);
  const limiter = new RateLimiter(config.rateWindow);
  const authLimiter = new RateLimiter(60000);
  const clients = new Map();
  const providers = dependencies.providers || geoProviders(config);
  const emit = (tenant, event) => { for (const res of clients.get(tenant) || []) res.write(`event: change\ndata: ${JSON.stringify({ type: event })}\n\n`); };
  const worker = createWorker(db, config, { ...dependencies, onEvent: emit });
  const json = (res, status, body) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(body)); };
  const findWidget = async (id, tenant) => {
    const row = await repo.ownerWidget(id, tenant);
    if (!row) throw new HttpError(404, 'Widget not found.'); return row;
  };
  async function auth(req) {
    const token = /(?:^|;\s*)relay_session=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie || '')?.[1];
    const user = token && await repo.sessionUser(hash(token));
    if (!user) throw new HttpError(401, 'Sign in to continue.'); return user;
  }
  function csrf(req) {
    if (req.headers.origin && req.headers.origin !== new URL(config.baseUrl).origin) throw new HttpError(403, 'Owner requests must come from the dashboard origin.');
  }
  const cookie = token => `relay_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${token ? config.sessionHours * 3600 : 0}${config.cookieSecure ? '; Secure' : ''}`;
  const publicConfig = w => ({ id: w.id, type: w.type, title: w.title, description: w.description, button_text: w.button_text, color: w.color, fields: w.fields, targeting: w.targeting, consent_text: consentText });
  const resultLead = row => ({ id: row.id, widget_id: row.widget_id, accepted: true, geo: row.geo ? JSON.parse(row.geo) : null });

  const server = http.createServer(async (req, res) => {
    const requestId = randomUUID();
    res.setHeader('X-Request-Id', requestId);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    let url;
    try { url = new URL(req.url, 'http://internal'); } catch { return json(res, 400, { error: 'Invalid URL.', request_id: requestId }); }
    const p = url.pathname, method = req.method;
    const isPublic = p === '/api/submissions' || /^\/api\/widgets\/[^/]+\/config$/.test(p) || p === '/widget.v1.js' || p === '/widget.js';
    if (isPublic) {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Idempotency-Key');
      res.setHeader('Access-Control-Expose-Headers', 'X-Request-Id, Retry-After, Idempotency-Replayed');
      res.setHeader('Access-Control-Max-Age', '600');
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      if (method === 'OPTIONS') { res.writeHead(204); return res.end(); }
    }
    const socketIp = req.socket.remoteAddress || 'unknown';
    const chain = [String(req.headers['x-forwarded-for'] || '').split(',').map(s => s.trim()).filter(Boolean), socketIp].flat();
    const ip = config.trustProxyHops ? chain[Math.max(0, chain.length - 1 - config.trustProxyHops)] : socketIp;
    try {
      if (p === '/favicon.ico' && method === 'GET') { res.writeHead(204); return res.end(); }
      if (p === '/health' && method === 'GET') return json(res, 200, { status: 'ok', version: '1.0.0', database: await repo.healthy() ? 'ready' : 'error' });
      if (p === '/widget.js' && method === 'GET') { res.writeHead(302, { Location: `/widget.v1.js${url.search}`, 'Cache-Control': 'public, max-age=300' }); return res.end(); }
      if (assets.has(p) && method === 'GET') {
        const [file, type] = assets.get(p);
        res.setHeader('Cache-Control', p === '/widget.v1.js' ? 'public, max-age=31536000, immutable' : 'no-cache');
        res.writeHead(200, { 'Content-Type': type }); return res.end(readFileSync(new URL(`../public/${file}`, import.meta.url)));
      }
      const configMatch = /^\/api\/widgets\/([^/]+)\/config$/.exec(p);
      if (configMatch && method === 'GET') {
        const w = await repo.publicWidget(configMatch[1]);
        if (!w) throw new HttpError(404, 'Widget not found.');
        const data = publicConfig(w), etag = `"${hash(JSON.stringify(data))}"`;
        res.setHeader('Cache-Control', 'public, max-age=30, must-revalidate'); res.setHeader('ETag', etag);
        if (req.headers['if-none-match'] === etag) { res.writeHead(304); return res.end(); }
        return json(res, 200, data);
      }
      if (p === '/api/submissions' && method === 'POST') {
        limiter.hit(`ip:${ip}`, config.rateIp);
        const body = await jsonBody(req);
        const id = text(body.widget_id, 'widget_id', 1, 80);
        const w = await repo.publicWidget(id);
        if (!w) throw new HttpError(404, 'Widget not found.');
        const lead = validateLead(body, w);
        const key = req.headers['idempotency-key'] === undefined ? null : text(req.headers['idempotency-key'], 'Idempotency-Key', 8, 128);
        const fingerprint = hash(stable(lead));
        async function replay() {
          if (!key) return false;
          const old = await repo.idempotentLead(id, key);
          if (!old) return false;
          if (old.payload_hash !== fingerprint) throw new HttpError(409, 'Idempotency key already used with different data.');
          res.setHeader('Idempotency-Replayed', 'true'); json(res, 200, resultLead(old)); return true;
        }
        if (await replay()) return;
        limiter.hit(`widget:${id}`, config.rateWidget);
        const geo = await enrich(ip, providers, config.geoMode);
        if (await replay()) return; // Concurrent retries may have committed during the async lookup.
        // Re-check after the async boundary: owners may have paused/deleted the widget.
        if (!await repo.publicWidget(id)) throw new HttpError(404, 'Widget unavailable.');
        const sid = randomUUID();
        try {
          await repo.storeLead({id:sid,widgetId:id,tenantId:w.tenant_id,data:lead.data,geo,source:lead.source,consentText,key,fingerprint});
        } catch(error) {
          if (error.code === '23505' || String(error.code).startsWith('ERR_SQLITE')) {
            if (await replay()) return;
          }
          throw error;
        }
        emit(w.tenant_id, 'submission'); return json(res, 201, { id: sid, widget_id: id, accepted: true, geo });
      }
      if ((p === '/api/auth/register' || p === '/api/auth/login') && method === 'POST') {
        csrf(req); authLimiter.hit(`auth:${ip}`, 15);
        const b = await jsonBody(req);
        onlyKeys(b, p.endsWith('register') ? ['name','email','password'] : ['email','password']);
        const email = text(b.email, 'email', 3, 250).toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(422, 'Enter a valid email.');
        const password = text(b.password, 'password', 10, 128);
        let user = await repo.userByEmail(email);
        if (p.endsWith('register')) {
          const name = text(b.name, 'workspace name', 1, 80);
          if (user) throw new HttpError(409, 'Account already exists.');
          const password_hash = await passwordHash(password);
          if (await repo.userByEmail(email)) throw new HttpError(409, 'Account already exists.');
          user = { id: randomUUID(), email, name };
          try { await repo.createUser(user,password_hash); }
          catch(error) { if(error.code==='23505')throw new HttpError(409,'Account already exists.');throw error; }
        } else if (!await passwordMatches(password, user?.password_hash || '00000000000000000000000000000000:' + '00'.repeat(64)) || !user) throw new HttpError(401, 'Invalid email or password.');
        const token = randomBytes(32).toString('hex');
        await repo.createSession(hash(token),user.id,Date.now()+config.sessionHours*3600000);
        res.setHeader('Set-Cookie', cookie(token));
        return json(res, p.endsWith('register') ? 201 : 200, { id: user.id, name: user.name, email: user.email });
      }
      if (!p.startsWith('/api/')) throw new HttpError(404, 'Route not found.');
      const user = await auth(req);
      if (!['GET','HEAD','OPTIONS'].includes(method)) csrf(req);
      if (p === '/api/auth/me' && method === 'GET') return json(res, 200, user);
      if (p === '/api/settings' && method === 'GET') return json(res,200,{demo_url:config.demoUrl});
      if (p === '/api/auth/logout' && method === 'POST') {
        const token = /relay_session=([a-f0-9]{64})/.exec(req.headers.cookie || '')?.[1];
        if (token) await repo.deleteSession(hash(token));
        res.setHeader('Set-Cookie', cookie('')); return json(res, 200, { ok: true });
      }
      if (p === '/api/events' && method === 'GET') {
        const set = clients.get(user.id) || new Set();
        if (set.size >= 5) throw new HttpError(429, 'Too many live dashboard connections.');
        res.writeHead(200, { 'Content-Type': 'text/event-stream', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
        res.write('event: ready\ndata: {}\n\n'); set.add(res); clients.set(user.id, set);
        const heartbeat = setInterval(async () => {
          try { await auth(req); res.write(': heartbeat\n\n'); } catch { res.end(); }
        }, 15000);
        req.on('close', () => { clearInterval(heartbeat); set.delete(res); if (!set.size) clients.delete(user.id); }); return;
      }
      if (p === '/api/widgets' && method === 'GET') {
        const rows = await repo.widgets(user.id);
        return json(res, 200, { items: rows });
      }
      if (p === '/api/widgets' && method === 'POST') {
        const b = validateWidget(await jsonBody(req)), id = await repo.createWidget(user.id,b);
        emit(user.id, 'widgets'); return json(res, 201, await findWidget(id, user.id));
      }
      const wm = /^\/api\/widgets\/([^/]+)(\/snippet)?$/.exec(p);
      if (wm) {
        const w = await findWidget(wm[1], user.id);
        if (wm[2] && method === 'GET') return json(res, 200, { snippet: `<script src="${config.baseUrl}/widget.v1.js?id=${w.id}" async></script>` });
        if (!wm[2] && method === 'GET') return json(res, 200, w);
        if (!wm[2] && ['PUT','PATCH'].includes(method)) {
          const b = validateWidget(await jsonBody(req), w);
          await repo.updateWidget(w.id,user.id,b);
          emit(user.id, 'widgets'); return json(res, 200, await findWidget(w.id,user.id));
        }
        if (!wm[2] && method === 'DELETE') {
          await repo.deleteWidget(w.id,user.id);
          emit(user.id,'widgets'); res.writeHead(204); return res.end();
        }
      }
      if (p === '/api/dashboard' && method === 'GET') {
        return json(res,200,{...await repo.dashboard(user.id),geo_mode:config.geoMode});
      }
      if (p === '/api/leads' && method === 'GET' || p === '/api/leads/export' && method === 'GET') {
        const page = Number(url.searchParams.get('page') || 1), size = Number(url.searchParams.get('limit') || 20);
        if (!Number.isInteger(page) || page < 1 || page > 100000 || !Number.isInteger(size) || size < 1 || size > 100) throw new HttpError(422,'Invalid pagination.');
        const filter = url.searchParams.get('widget_id'), status = url.searchParams.get('status'), q = url.searchParams.get('q') || '';
        if (q.length > 100 || status && !['new','contacted','qualified','archived'].includes(status)) throw new HttpError(422,'Invalid filter.');
        const exporting = p.endsWith('export');
        const result=await repo.leads(user.id,{filter,status,q,page,size,exporting}),rows=result.items;
        if (exporting) {
          const cell = v => { let s = String(v ?? ''); if (/^[\s]*[=+@\-\t\r]/.test(s)) s = `'${s}`; return `"${s.replaceAll('"','""')}"`; };
          res.writeHead(200, { 'Content-Type':'text/csv; charset=utf-8', 'Content-Disposition':'attachment; filename="relay-leads.csv"' });
          return res.end(['id,widget,name,email,country,city,status,consent,created_at,data', ...rows.map(r => [r.id,r.widget_name,r.data.name,r.data.email,r.geo?.country,r.geo?.city,r.status,r.consent,r.created_at,JSON.stringify(r.data)].map(cell).join(','))].join('\r\n'));
        }
        return json(res,200,result);
      }
      const lm = /^\/api\/leads\/([^/]+)$/.exec(p);
      if (lm) {
        const lead = await repo.lead(lm[1],user.id);
        if (!lead) throw new HttpError(404,'Lead not found.');
        if (method === 'GET') return json(res,200,lead);
        if (method === 'PATCH') {
          const b = await jsonBody(req); onlyKeys(b,['status']);
          if (!['new','contacted','qualified','archived'].includes(b.status)) throw new HttpError(422,'Invalid lead status.');
          await repo.updateLead(lead.id,user.id,b.status);
          emit(user.id,'submission'); return json(res,200,{...lead,status:b.status});
        }
        if (method === 'DELETE') {
          await repo.deleteLead(lead.id,user.id);
          emit(user.id,'submission'); res.writeHead(204); return res.end();
        }
      }
      if (p === '/api/jobs' && method === 'GET') return json(res,200,{items:await repo.jobs(user.id)});
      const jm = /^\/api\/jobs\/([^/]+)\/retry$/.exec(p);
      if (jm && method === 'POST') {
        if (!await repo.retryJob(jm[1],user.id)) throw new HttpError(404,'Dead-letter job not found.');
        return json(res,200,{ok:true});
      }
      if (p === '/api/audit' && method === 'GET') return json(res,200,{items:await repo.audit(user.id)});
      throw new HttpError(404,'Route not found.');
    } catch (error) {
      if (res.headersSent) { res.end(); return; }
      if (error.retryAfter) res.setHeader('Retry-After',error.retryAfter);
      if (!error.status) (dependencies.log || console).error(JSON.stringify({event:'request.failed',request_id:requestId}));
      json(res,error.status || 500,{error:error.status ? error.message : 'Internal server error.',...(error.details ? {details:error.details} : {}),request_id:requestId});
    }
  });
  server.requestTimeout = 15000; server.headersTimeout = 10000; server.maxHeadersCount = 50;
  return { server,db,worker,config, async close() { for (const set of clients.values()) for (const r of set) r.end(); await worker.stop(); await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }); await db.close(); } };
}
