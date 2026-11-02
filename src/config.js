import path from 'node:path';

export function config(overrides = {}) {
  const integer = (name, fallback, min = 1) => {
    const n = Number(process.env[name] ?? fallback);
    if (!Number.isInteger(n) || n < min) throw new Error(`Invalid ${name}`);
    return n;
  };
  return {
    port: integer('PORT', 4100, 0), host: process.env.HOST || '127.0.0.1',
    baseUrl: process.env.BASE_URL || process.env.RENDER_EXTERNAL_URL || 'http://localhost:4100',
    databaseUrl: process.env.DATABASE_URL || '',
    demoUrl: process.env.DEMO_URL || 'http://localhost:5500',
    databasePath: path.resolve(process.env.DATABASE_PATH || './data/relay.sqlite'),
    geoMode: process.env.GEO_MODE || 'mock',
    geoADown: process.env.MOCK_GEO_A_DOWN === 'true', geoBDown: process.env.MOCK_GEO_B_DOWN === 'true',
    notificationMode: process.env.NOTIFICATION_MODE || 'console',
    jobInterval: integer('JOB_INTERVAL_MS', 1000), jobMaxAttempts: integer('JOB_MAX_ATTEMPTS', 3),
    rateIp: integer('RATE_LIMIT_IP', 20), rateWidget: integer('RATE_LIMIT_WIDGET', 100),
    rateWindow: integer('RATE_WINDOW_MS', 60000), sessionHours: integer('SESSION_TTL_HOURS', 24),
    cookieSecure: process.env.COOKIE_SECURE === 'true', trustProxyHops: integer('TRUST_PROXY_HOPS', 0, 0),
    ...overrides,
  };
}
