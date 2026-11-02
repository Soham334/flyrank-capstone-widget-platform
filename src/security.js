import { randomBytes, scrypt as scryptCb, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
const scrypt = promisify(scryptCb);
export const hash = value => createHash('sha256').update(value).digest('hex');
export async function passwordHash(password) {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${(await scrypt(password, salt, 64)).toString('hex')}`;
}
export async function passwordMatches(password, stored) {
  const [salt, key] = stored.split(':');
  const actual = await scrypt(password, salt, 64);
  return timingSafeEqual(actual, Buffer.from(key, 'hex'));
}
export class HttpError extends Error {
  constructor(status, message, details) { super(message); this.status = status; this.details = details; }
}
export class RateLimiter {
  constructor(windowMs) { this.windowMs = windowMs; this.entries = new Map(); }
  hit(key, max) {
    const time = Date.now();
    let entry = this.entries.get(key);
    if (!entry || entry.until <= time) {
      if (this.entries.size > 10000) for (const [k, v] of this.entries) if (v.until <= time) this.entries.delete(k);
      // Bound memory under rotating-client abuse. Active buckets are never evicted to bypass a limit.
      if (!this.entries.has(key) && this.entries.size >= 20000) throw new HttpError(429, 'Rate limiter at capacity. Try again shortly.');
      entry = { count: 0, until: time + this.windowMs }; this.entries.set(key, entry);
    }
    entry.count++;
    if (entry.count > max) {
      const error = new HttpError(429, 'Too many requests. Try again shortly.');
      error.retryAfter = Math.max(1, Math.ceil((entry.until - time) / 1000)); throw error;
    }
  }
}
export async function jsonBody(req, limit = 16384) {
  if (!(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) throw new HttpError(415, 'Use application/json.');
  let bytes = 0; const chunks = [];
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    bytes += chunk.length;
    if (bytes > limit) { req.resume(); throw new HttpError(413, 'Payload exceeds 16 KB.'); }
    chunks.push(chunk);
  }
  try {
    const result = JSON.parse(Buffer.concat(chunks).toString());
    if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error();
    return result;
  } catch { throw new HttpError(400, 'Malformed JSON object.'); }
}
export function text(value, name, min = 1, max = 200) {
  if (typeof value !== 'string' || value.trim().length < min || value.trim().length > max) throw new HttpError(422, `${name} must contain ${min}–${max} characters.`);
  return value.trim();
}
export function onlyKeys(obj, allowed) {
  const unknown = Object.keys(obj).filter(key => !allowed.includes(key));
  if (unknown.length) throw new HttpError(422, 'Unknown fields.', unknown);
}
export function validateWidget(body, previous) {
  onlyKeys(body, ['name','type','title','description','button_text','color','fields','active','targeting']);
  const b = { type: 'signup', description: '', button_text: 'Join the list', color: '#7957e8',
    fields: [{ name: 'name', label: 'Your name', type: 'text', required: true }, { name: 'email', label: 'Email address', type: 'email', required: true }],
    active: true, targeting: { path: '', delay: 0, once: false }, ...previous, ...body };
  b.name = text(b.name, 'name', 1, 80); b.title = text(b.title, 'title', 1, 100);
  b.description = text(b.description, 'description', 0, 400); b.button_text = text(b.button_text, 'button_text', 1, 40);
  if (!['signup','contact','popover'].includes(b.type)) throw new HttpError(422, 'Unsupported widget type.');
  if (!/^#[0-9a-f]{6}$/i.test(b.color)) throw new HttpError(422, 'Use a six-digit hex color.');
  if (typeof b.active !== 'boolean') throw new HttpError(422, 'active must be boolean.');
  if (!Array.isArray(b.fields) || !b.fields.length || b.fields.length > 8) throw new HttpError(422, 'Use 1–8 form fields.');
  const names = new Set();
  for (const field of b.fields) {
    if (!field || typeof field !== 'object') throw new HttpError(422, 'Invalid field.');
    onlyKeys(field, ['name','label','type','required']);
    if (typeof field.name !== 'string' || !/^[a-z][a-z0-9_]{0,29}$/.test(field.name) || ['__proto__','constructor','prototype'].includes(field.name) || names.has(field.name)) throw new HttpError(422, 'Field names must be unique lowercase identifiers.');
    names.add(field.name); field.label = text(field.label, 'field label', 1, 60);
    if (!['text','email','textarea','tel'].includes(field.type) || typeof field.required !== 'boolean') throw new HttpError(422, 'Invalid field type or required flag.');
  }
  if (!b.targeting || typeof b.targeting !== 'object' || Array.isArray(b.targeting)) throw new HttpError(422, 'Invalid targeting.');
  onlyKeys(b.targeting, ['path','delay','once']);
  const t = b.targeting;
  if (typeof t.path !== 'string' || t.path.length > 200 || !Number.isInteger(t.delay) || t.delay < 0 || t.delay > 60 || typeof t.once !== 'boolean') throw new HttpError(422, 'Targeting needs path, delay (0–60 seconds), and once.');
  return b;
}
export function validateLead(body, w) {
  onlyKeys(body, ['widget_id','data','website','consent','source']);
  if (body.website !== undefined && typeof body.website !== 'string') throw new HttpError(422, 'Invalid spam field.');
  if (body.website) throw new HttpError(422, 'Submission rejected.');
  if (body.consent !== true) throw new HttpError(422, 'Consent is required.');
  if (!body.data || typeof body.data !== 'object' || Array.isArray(body.data)) throw new HttpError(422, 'data must be an object.');
  onlyKeys(body.data, w.fields.map(f => f.name));
  const data = Object.create(null);
  for (const field of w.fields) {
    const value = body.data[field.name] ?? '';
    data[field.name] = text(value, field.label, field.required ? 1 : 0, field.type === 'textarea' ? 2000 : 250);
    if (field.type === 'email' && value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) throw new HttpError(422, 'Enter a valid email address.');
  }
  let source = '';
  if (body.source) {
    source = text(body.source, 'source', 1, 500);
    try { const u = new URL(source); if (!['http:','https:'].includes(u.protocol)) throw new Error(); source = u.origin + u.pathname; }
    catch { throw new HttpError(422, 'source must be an HTTP URL.'); }
  }
  return { data, source, consent: true };
}
