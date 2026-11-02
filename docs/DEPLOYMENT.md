# Free deployment: Render + Neon

Status: prepared, **not deployed**. The dedicated public source repository is [Soham334/flyrank-capstone-widget-platform](https://github.com/Soham334/flyrank-capstone-widget-platform). Render and Neon plugins are installed, but their account-management tools are not available in the authoring chat. No paid service or hosted database has been created by this preparation.

## Why this deployment uses Postgres

Render's free web service has an ephemeral filesystem. A local SQLite file would disappear on a restart or redeploy. Set `DATABASE_URL` to a Neon Free Postgres connection string instead. Without this setting, startup deliberately refuses to run on Render. Local development keeps SQLite when `DATABASE_URL` is blank.

Provider references, checked 2026-11-02: [Render Free](https://render.com/docs/free), [Neon pricing](https://neon.com/pricing). Select only Free plans and do not add payment details. Free services have usage quotas and cold starts. Render can suspend a service after its free usage is exhausted; Neon Free also has compute/storage limits. No perpetual uptime guarantee is made.

## Account setup

1. Create an empty standalone GitHub repository named `flyrank-capstone-widget-platform`. Upload only this project's files, including dotfiles; do not upload `.env`, `data`, or `node_modules`.
2. Sign in to Neon and create a project on **Free**. Copy its pooled Postgres connection string with TLS enabled. Keep it secret; do not paste it into chat or commit it.
3. In Render, create a Blueprint from the repository's `render.yaml`. The API service explicitly selects `plan: free`; the customer demonstration is a separate free static site.
4. Store the Neon connection string in the API service's `DATABASE_URL` environment secret. Set `DEMO_URL` to the customer static site's assigned HTTPS URL.
5. Keep `HOST=0.0.0.0`, `COOKIE_SECURE=true` and `TRUST_PROXY_HOPS=1` for the single Render proxy. Render supplies `PORT` and `RENDER_EXTERNAL_URL`; the API uses that URL for origin checks and embed snippets. Set `BASE_URL` explicitly only if using a different public hostname.
6. Deploy. Startup applies the Postgres schema migration transactionally. Register your own owner workspace in the dashboard. No public demo password or seed account is created automatically on the hosted database.

The hosted start command is `npm start` and the build command is `npm ci --omit=dev`. The API and worker remain one process, with Postgres persisting sessions, leads, consent, widgets, audit events and pending jobs. Deploy one API instance; distributed job leases and shared rate-limit buckets are outside this configuration.

## Verify the live deployment

- `GET https://YOUR-API/health` must return 200 with `database: ready`.
- Register a workspace, create a widget, and open **Get snippet**. Its script must use the deployed HTTPS API origin.
- Open the linked customer static site, submit a consented lead, and watch the live dashboard increment.
- Redeploy the API, sign in again, and verify the lead survives.
- Confirm cookie responses include `Secure; HttpOnly; SameSite=Strict` and cross-origin public POST/OPTIONS work.
- Run the deterministic local acceptance suite with `npm test`. Real hosted provider availability is a separate check.

`GEO_MODE=mock` and `NOTIFICATION_MODE=console` remain intentional demonstration defaults. Console notification is not a real email. Switch to live geo only after reviewing its privacy/quotas; do not claim mock location results are actual visitor geolocation.

Render sleeps free services after inactivity. Notification retries resume when the service wakes; background delivery is not guaranteed while the host is asleep. A free sleeping host is suitable for this capstone demonstration, not a production notification SLA.

## Local commands after adding hosted support

```sh
npm ci
npm run seed
npm start
```

In a second terminal, `npm run demo`. With no `DATABASE_URL`, this still uses the original local SQLite database. `npm run seed` only seeds local SQLite; on a hosted deployment register a new workspace through the UI.

## Verification status

The 17 local SQLite HTTP acceptance tests pass after the async repository integration. Full Postgres and hosted end-to-end verification require an accessible Postgres server and connected hosting accounts. No remote deployment success or hosted data-persistence test is claimed before those checks run.
