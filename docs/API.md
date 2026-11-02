# API contract

Base URL: `http://localhost:4100`. All request bodies are JSON objects (`Content-Type: application/json`) with a maximum size of 16 KB. Unknown keys are rejected. Errors are JSON: `{"error":"Human-readable message","request_id":"UUID"}` with optional `details`. IDs are opaque UUID strings. Owner endpoints require the `relay_session` cookie. Browser owner mutation origins must match `BASE_URL`.

## Authentication

| Method | Path | Body / response |
| --- | --- | --- |
| POST | /api/auth/register | `{name,email,password}` → 201 user and session cookie |
| POST | /api/auth/login | `{email,password}` → 200 user and session cookie |
| GET | /api/auth/me | 200 `{id,name,email}` or 401 |
| POST | /api/auth/logout | 200 `{ok:true}`, invalidates session and clears cookie |

Passwords: 10–128 characters; emails normalized to lowercase. Session lifetime defaults to 24 hours. Auth calls have an independent 15-request/minute/IP budget.

## Widgets (owner)

| Method | Path | Result |
| --- | --- | --- |
| GET | /api/widgets | 200 `{items:[widget]}` with per-widget lead counts |
| POST | /api/widgets | 201 created widget |
| GET | /api/widgets/:id | 200 owner widget |
| PATCH or PUT | /api/widgets/:id | 200 updated widget; both accept partial validated changes |
| DELETE | /api/widgets/:id | 204; cascades leads and jobs |
| GET | /api/widgets/:id/snippet | 200 `{snippet:"<script ...></script>"}` |

Example creation (name and title required; other fields have defaults):

```json
{
  "name": "Newsletter",
  "type": "signup",
  "title": "Good things, in your inbox.",
  "description": "Stay in the loop.",
  "button_text": "Join us",
  "color": "#7957e8",
  "fields": [
    {"name":"name","label":"Your name","type":"text","required":true},
    {"name":"email","label":"Email address","type":"email","required":true}
  ],
  "active": true,
  "targeting": {"path":"","delay":0,"once":false}
}
```

Types: signup/contact/popover. Up to 8 unique lowercase field identifiers. Types: text/email/textarea/tel. Text answers cap at 250 characters, textarea at 2,000. Targeting delay is an integer 0–60 seconds; path matches a prefix. `once` hides after successful submission using optional localStorage. Required consent is rendered separately from configurable fields.

## Public delivery and submissions

| Method | Path | Behavior |
| --- | --- | --- |
| GET | /widget.v1.js?id=:id | Immutable script; max-age=31536000 |
| GET | /widget.js?id=:id | 302 to versioned file; max-age=300 |
| GET | /api/widgets/:id/config | Public safe configuration; max-age=30; ETag / 304 |
| OPTIONS | /api/submissions or public config | 204 CORS preflight |
| POST | /api/submissions | 201 newly accepted lead; 200 idempotent replay |

Public CORS uses `Access-Control-Allow-Origin: *`, no credentials, and allows `Content-Type` and `Idempotency-Key`. Public configuration omits owner identity and tenant metadata.

```json
{
  "widget_id": "COPY_WIDGET_ID",
  "data": {"name":"Ada Lovelace","email":"ada@example.com"},
  "website": "",
  "consent": true,
  "source": "http://localhost:5500/article"
}
```

`website` is the honeypot. Filled values return 422 and are not stored. `consent` must be true. Source, if supplied, must use HTTP/HTTPS; query parameters and fragments are discarded. Raw IP addresses are not persisted. Expected response:

```json
{"id":"LEAD_ID","widget_id":"WIDGET_ID","accepted":true,"geo":{"country":"India","country_code":"IN","city":"Bengaluru","provider":"mock-a"}}
```

Geo can be null without changing the successful status. `Idempotency-Key` is optional (8–128 characters); the embed sends one per distinct pending form payload. Retries must use the same key and normalized payload. Replay returns the original ID and `Idempotency-Replayed: true`; changed payload returns 409. Dedupe lasts until that lead is deleted.

Default submission quotas are 20/IP/minute and 100/widget/minute. Validation failures consume the IP budget. Replays consume IP budget but not widget budget. Rejected bursts return 429 with `Retry-After`; health and private APIs remain independently accessible.

## Dashboard, leads and operations (owner)

| Method | Path | Response |
| --- | --- | --- |
| GET | /api/dashboard | `{total,today,active,enriched,timeseries,countries,per_widget,jobs,geo_mode}` |
| GET | /api/leads | `{items,total,page,limit}`; filters `q`, `widget_id`, `status`, `page`, `limit` |
| GET | /api/leads/export | CSV with same filters; max 10,000 rows; ignores pagination |
| GET | /api/leads/:id | Full lead data, geo, source, consent record and timestamp |
| PATCH | /api/leads/:id | `{status}`; new/contacted/qualified/archived |
| DELETE | /api/leads/:id | 204; cascades associated delivery job |
| GET | /api/jobs | Latest 100 tenant-owned jobs |
| POST | /api/jobs/:id/retry | Only dead-letter jobs; 200 `{ok:true}` |
| GET | /api/audit | Latest 100 tenant-owned events |
| GET | /api/events | Authenticated SSE: `ready` and `change`; max 5 connections per tenant |
| GET | /health | Public liveness and database readiness |

Lead pages default to 20 and cap at 100. “Today” uses UTC. Timeseries covers the last 30 UTC dates. SSE change messages contain only an invalidation type, not lead PII. Sessions are rechecked on heartbeat; logout invalidates subsequent requests immediately, and an existing stream closes at its next heartbeat (within 15 seconds).

## Curl walkthrough

These examples use Bash/curl syntax. On PowerShell, use `curl.exe` explicitly, or `Invoke-RestMethod` with JSON created using `ConvertTo-Json`.

```sh
curl -c cookies.txt -H 'Content-Type: application/json' \
  -d '{"email":"demo@relay.local","password":"RelayDemo!2026"}' \
  http://localhost:4100/api/auth/login
curl -b cookies.txt http://localhost:4100/api/widgets
curl -i -X OPTIONS -H 'Origin: http://localhost:5500' \
  -H 'Access-Control-Request-Method: POST' \
  -H 'Access-Control-Request-Headers: content-type,idempotency-key' \
  http://localhost:4100/api/submissions
curl -i -H 'Origin: http://localhost:5500' -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: demo-curl-unique-001' \
  -d '{"widget_id":"COPY_WIDGET_ID","data":{"name":"Ada","email":"ada@example.com"},"website":"","consent":true,"source":"http://localhost:5500/"}' \
  http://localhost:4100/api/submissions
curl -b cookies.txt http://localhost:4100/api/leads
```

4xx contract: 400 malformed JSON, 401 unauthenticated, 403 owner-origin mismatch, 404 absent/unowned/paused widget or lead, 409 conflicting idempotency/account, 413 oversized body, 415 wrong content type, 422 invalid schema/consent/spam, 429 rate limit. Unexpected failures use generic 500 without internal details; diagnostic correlation uses X-Request-Id.
