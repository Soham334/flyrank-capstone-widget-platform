import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export const now = () => new Date().toISOString();
export function openDatabase(filename) {
  if (filename !== ':memory:') mkdirSync(path.dirname(filename), { recursive: true });
  const db = new DatabaseSync(filename);
  db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
  try {
    db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)');
    const folder=new URL('../migrations/',import.meta.url);
    for(const file of readdirSync(folder).filter(f=>/^\d+_.+\.sql$/.test(f)).sort()) {
      const version=Number(file.split('_')[0]);
      transaction(db,()=>{
        if(db.prepare('SELECT version FROM schema_migrations WHERE version=?').get(version))return;
        db.exec(readFileSync(new URL(file,folder),'utf8'));
        db.prepare('INSERT INTO schema_migrations VALUES (?,?)').run(version,now());
      });
    }
  } catch (error) { db.close(); throw error; }
  return db;
}
export function transaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const result = fn(); db.exec('COMMIT'); return result; }
  catch (error) { db.exec('ROLLBACK'); throw error; }
}
export function audit(db, tenant, action, entity) {
  db.prepare('INSERT INTO audit_events VALUES (?,?,?,?,?)').run(randomUUID(), tenant, action, entity, now());
}
export function widget(row) {
  return row && { ...row, fields: JSON.parse(row.fields), targeting: JSON.parse(row.targeting), active: Boolean(row.active) };
}
export function submission(row) {
  if (!row) return null;
  const { idempotency_key, payload_hash, ...safe } = row;
  return { ...safe, data: JSON.parse(row.data), geo: row.geo ? JSON.parse(row.geo) : null, consent: Boolean(row.consent) };
}
