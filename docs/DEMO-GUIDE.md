# Demo and viva guide

## A six-minute walkthrough

1. Run `npm run seed`, `npm start`, and `npm run demo` in two terminals. Sign in with the fictional demo account. Explain that all initial charts are seeded fixtures.
2. Create a new widget with a title, color and fields. Explain how field schema validation happens again on the server. Copy its one-line snippet.
3. Open the linked customer site on port 5500. Explain that the browser loads config and posts to port 4100 without sharing owner cookies. Submit with consent, then watch the owner dashboard increment automatically via SSE.
4. Search for the new lead, open its details, mark it qualified, and export a CSV. Discuss consent text, source minimization, and deletion.
5. Run `npm test`. Show the named fallback, all-down, rate-limit, idempotency, notification and isolation cases in EVIDENCE.md. These tests use mocks to prove failure scenarios deterministically.
6. Open Activity & jobs. Set `NOTIFICATION_MODE=fail` and restart for a live retry/dead-letter demo; restore console mode and retry the dead job. Explain that the lead was safely committed before the worker ran.

## Questions you should be able to answer

| Question | Explain using the implementation |
| --- | --- |
| Why is CORS not authentication? | Public widgets intentionally allow all origins. Owner data still requires a session and a tenant predicate. Attackers can send non-browser requests regardless of CORS. |
| How can you prove tenant isolation? | Repository queries bind tenant IDs; tests attempt another tenant's reads, writes, deletes, exports, jobs and analytics. |
| Why hash sessions? | A stolen database contains only token digests, not bearer cookies. Tokens have 256 bits of randomness and expire. |
| How is a notification guaranteed to be queued? | A lead and its job are written in one SQL transaction: transactional outbox. |
| Does this guarantee exactly-once email? | No. A crash after dispatch but before marking success can redeliver. A downstream adapter must deduplicate the stable job UUID. |
| Why recheck idempotency after geo lookup? | Async calls let simultaneous retries interleave. The second check plus a uniqueness constraint prevents duplicate acceptance. |
| Why not trust X-Forwarded-For by default? | A direct client can forge it. Proxy hop count is an explicit deployment trust choice. |
| Why SQLite? | Real persistent indexed SQL, WAL, migrations and transactions with no external setup. The tradeoff is single-process concurrency and synchronous database work. |
| What happens when both geo APIs fail? | Null geo is valid. The submission still commits and returns 201. |
| Why is the bundle filename versioned? | An immutable long cache must receive a new URL on release. Config uses a short TTL because owners can edit it. |
| How does this scale? | Move SQL to Postgres, rate buckets to Redis, events to a broker, and jobs to leased workers. Add indexed aggregate/reporting strategies. |
| What is deliberately unfinished? | Public publication, historical phase commits, real email, distributed controls, production hosting, and Docker runtime evidence. |

Read `src/app.js`, `src/security.js`, `src/repository.js`, `src/enrichment.js` and `src/jobs.js`. Practice explaining a complete request from the widget to the database and from the job queue to a dead-letter alert. Add your own BUILDLOG entries as you learn and change the project.
