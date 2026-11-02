import { now } from './database.js';

export function createWorker(db, config, { notify, onEvent = () => {}, log = console } = {}) {
  // One process owns the queue. A crash may have left a delivery in progress.
  const ready=Promise.resolve(db.prepare("UPDATE jobs SET status='pending' WHERE status='running'").run());
  let busy = false;
  const send = notify || (async job => {
    if (config.notificationMode === 'fail') throw new Error('Simulated notification outage');
    // No lead PII, email address, IP, credential, or token is logged.
    log.info(JSON.stringify({ event: 'notification.delivered', job_id: job.id }));
  });
  async function tick() {
    if (busy) return;
    busy = true;
    try {
      await ready;
      const jobs = await db.prepare("SELECT * FROM jobs WHERE status='pending' AND available_at<=? ORDER BY available_at LIMIT 10").all(Date.now());
      for (const job of jobs) {
        await db.prepare("UPDATE jobs SET status='running',attempts=attempts+1,updated_at=? WHERE id=?").run(now(), job.id);
        try {
          await send(job); // Receivers should deduplicate using the stable job.id.
          await db.prepare("UPDATE jobs SET status='delivered',last_error=NULL,updated_at=? WHERE id=?").run(now(), job.id);
        } catch {
          const attempts = job.attempts + 1;
          const dead = attempts >= config.jobMaxAttempts;
          await db.prepare('UPDATE jobs SET status=?,available_at=?,last_error=?,updated_at=? WHERE id=?')
            .run(dead ? 'dead' : 'pending', Date.now() + Math.min(60000, 1000 * 2 ** attempts), 'Notification delivery failed', now(), job.id);
          if (dead) log.error(JSON.stringify({ event: 'notification.dead_letter', job_id: job.id, attempts }));
        }
        onEvent(job.tenant_id, 'jobs');
      }
    } finally { busy = false; }
  }
  const interval = setInterval(() => tick().catch(() => log.error('Worker tick failed')), config.jobInterval);
  interval.unref();
  return { ready,tick, async stop() { clearInterval(interval); await ready; while (busy) await new Promise(resolve => setTimeout(resolve, 10)); } };
}
