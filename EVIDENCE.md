# Acceptance evidence

Generated from actual verification on 2026-11-02T14:06:41.026Z.

API tests: **17 passed**, exit code 0. Full unedited output: [api-tests.txt](docs/evidence/api-tests.txt). No external geo API is used by these tests.

| Requirement | Concrete proof |
| --- | --- |
| Authenticated widget CRUD | auth: registration; widget CRUD |
| Tenant A cannot access tenant B widgets or submissions | tenant isolation covers widget reads, updates, deletes, snippets, leads, jobs, exports and analytics |
| Generated embed snippet | widget CRUD, validation, generated snippet, versioned cache and conditional config |
| Small cached public config | widget CRUD: max-age=30, ETag and 304 assertions |
| Versioned JavaScript with cache busting URL | widget CRUD: /widget.v1.js and immutable one-year cache |
| Widget renders on a different-origin customer site | Browser: Different-origin widget render |
| Cross-origin POST and OPTIONS preflight | public CORS preflight and cross-origin submission store a linked, consented, enriched row |
| Malformed, oversized and invalid payload rejection | malformed, oversized, invalid content type and invalid fields return clean 4xx JSON |
| Validated storage with correct widget and tenant | public CORS preflight; tenant isolation; persistence survives database reopen |
| IP/widget burst protection and continued legitimate availability | per-IP rate limiting; per-widget rate limiting isolates burst traffic from a second widget |
| Spam control blocks a filled honeypot | honeypot rejects spam without storing a lead or notification |
| Provider A outage falls back to B | provider A outage falls back to B; all geo providers down still stores lead |
| All geo providers fail without losing the lead | provider A outage falls back to B; all geo providers down still stores lead |
| Notification failure does not fail acceptance | notification failure is off request path, retries persist, dead letter alerts and owner retry work |
| README, architecture, setup, API docs and required submission files | Local file presence check below |

Required files checked: `README.md`, `DESIGN.md`, `capstone.yaml`, `BUILDLOG.md`, `.env.example`, `docs/API.md`, `docs/openapi.json`.

## Shared requirements and stretch evidence

- Layer boundaries: HTTP orchestration in app.js, validation/security in security.js, SQL in repository.js, provider policy in enrichment.js, delivery lifecycle in jobs.js.
- Persistent migrations and restart recovery: persistence test reopens the file, checks the stored lead, session, idempotency record and an interrupted delivery recovered to pending.
- Atomic background delivery intent: outbox failure test injects a SQL trigger failure and proves both lead and job roll back.
- Idempotency: five concurrent same-key submissions produce one lead/job; changed payload returns 409.
- Background retries + alert: notification test advances due times, verifies dead-letter status and structured alert, then retries successfully.
- Secret handling: salted password hashes and hashed session tokens asserted in auth test; source ignores .env and data files. Demo credentials are deliberately public.
- Runtime AI cost attribution: not applicable; application makes no AI API calls.
- Consent, lead status, export/delete: dashboard and CSV formula-injection tests.
- Targeting and Shadow DOM: implemented in public/widget.v1.js; browser verifies rendered form and successful submit, not every targeting combination.
- Live dashboard: browser check verifies SSE increments the metric automatically.

## Browser verification

Recorded 2026-10-31T20:04:28.223Z, browser 156.0.4314.50. [Machine-readable results](docs/evidence/browser-results.json).

- PASS: Sign-in
- PASS: Dashboard renders real aggregates
- PASS: Create widget through UI
- PASS: Builder preview
- PASS: Snippet generation
- PASS: Different-origin widget render
- PASS: Different-origin POST returns 201
- PASS: SSE automatically increments dashboard metric
- PASS: Lead visible in owner dashboard
- PASS: Lead status update
- PASS: 390px mobile layout without overflow
- PASS: Edit dialog opens
- PASS: No browser JS or CSP errors

[signin-desktop.png](docs/evidence/signin-desktop.png) · [dashboard-desktop.png](docs/evidence/dashboard-desktop.png) · [widget-builder.png](docs/evidence/widget-builder.png) · [cross-origin-widget.png](docs/evidence/cross-origin-widget.png) · [dashboard-mobile.png](docs/evidence/dashboard-mobile.png)

## Honest outstanding evidence

Public GitHub publication, historical phase commits, portal submission and a successful hosted CI run have not been performed. Docker Desktop engine was unavailable, so no container build/runtime success is claimed. Real geo providers and real email delivery are not acceptance evidence; deterministic provider adapters and console delivery are used. Seeded dashboard history is fictional and is not proof of live traffic.
