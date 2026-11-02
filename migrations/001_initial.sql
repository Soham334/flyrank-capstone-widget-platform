CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
CREATE TABLE IF NOT EXISTS widgets (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL, type TEXT NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL,
  button_text TEXT NOT NULL, color TEXT NOT NULL, fields TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1, targeting TEXT NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS widgets_tenant ON widgets(tenant_id, created_at);
CREATE TABLE IF NOT EXISTS submissions (
  id TEXT PRIMARY KEY, widget_id TEXT NOT NULL REFERENCES widgets(id) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  data TEXT NOT NULL, geo TEXT, source TEXT NOT NULL, consent INTEGER NOT NULL,
  consent_text TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'new', created_at TEXT NOT NULL,
  idempotency_key TEXT, payload_hash TEXT,
  UNIQUE(widget_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS submissions_tenant_time ON submissions(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS submissions_widget_time ON submissions(widget_id, created_at DESC);
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  submission_id TEXT NOT NULL UNIQUE REFERENCES submissions(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,
  available_at INTEGER NOT NULL, last_error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS jobs_due ON jobs(status, available_at);
CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  action TEXT NOT NULL, entity_id TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS audit_tenant_time ON audit_events(tenant_id, created_at DESC);
