import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
const result=spawnSync(process.execPath,['--test','--test-reporter=tap','--test-concurrency=1','test/platform.test.js'],{encoding:'utf8',cwd:new URL('../',import.meta.url),timeout:120000});
const output=(result.stdout||'')+(result.stderr||'');
mkdirSync(new URL('../docs/evidence/',import.meta.url),{recursive:true});
writeFileSync(new URL('../docs/evidence/api-tests.txt',import.meta.url),output);
process.stdout.write(output);
if(result.status!==0){console.error('Verification failed. No passing requirement report was generated.');process.exitCode=1;}
else{
  const rows=[
    ['Authenticated widget CRUD','auth: registration; widget CRUD'],
    ['Tenant A cannot access tenant B widgets or submissions','tenant isolation covers widget reads, updates, deletes, snippets, leads, jobs, exports and analytics'],
    ['Generated embed snippet','widget CRUD, validation, generated snippet, versioned cache and conditional config'],
    ['Small cached public config','widget CRUD: max-age=30, ETag and 304 assertions'],
    ['Versioned JavaScript with cache busting URL','widget CRUD: /widget.v1.js and immutable one-year cache'],
    ['Widget renders on a different-origin customer site','Browser: Different-origin widget render'],
    ['Cross-origin POST and OPTIONS preflight','public CORS preflight and cross-origin submission store a linked, consented, enriched row'],
    ['Malformed, oversized and invalid payload rejection','malformed, oversized, invalid content type and invalid fields return clean 4xx JSON'],
    ['Validated storage with correct widget and tenant','public CORS preflight; tenant isolation; persistence survives database reopen'],
    ['IP/widget burst protection and continued legitimate availability','per-IP rate limiting; per-widget rate limiting isolates burst traffic from a second widget'],
    ['Spam control blocks a filled honeypot','honeypot rejects spam without storing a lead or notification'],
    ['Provider A outage falls back to B','provider A outage falls back to B; all geo providers down still stores lead'],
    ['All geo providers fail without losing the lead','provider A outage falls back to B; all geo providers down still stores lead'],
    ['Notification failure does not fail acceptance','notification failure is off request path, retries persist, dead letter alerts and owner retry work'],
    ['README, architecture, setup, API docs and required submission files','Local file presence check below'],
  ];
  const required=['README.md','DESIGN.md','capstone.yaml','BUILDLOG.md','.env.example','docs/API.md','docs/openapi.json'];
  for(const file of required)if(!existsSync(new URL('../'+file,import.meta.url)))throw new Error('Missing required file: '+file);
  let browser=null;try{browser=JSON.parse(readFileSync(new URL('../docs/evidence/browser-results.json',import.meta.url),'utf8'));}catch{}
  const passed=(output.match(/^# pass (\d+)/m)||[])[1]||'?';
  const report=`# Acceptance evidence\n\nGenerated from actual verification on ${new Date().toISOString()}.\n\nAPI tests: **${passed} passed**, exit code 0. Full unedited output: [api-tests.txt](docs/evidence/api-tests.txt). No external geo API is used by these tests.\n\n| Requirement | Concrete proof |\n| --- | --- |\n${rows.map(([r,p])=>`| ${r} | ${p} |`).join('\n')}\n\nRequired files checked: ${required.map(f=>'`'+f+'`').join(', ')}.\n\n## Shared requirements and stretch evidence\n\n- Layer boundaries: HTTP orchestration in app.js, validation/security in security.js, SQL in repository.js, provider policy in enrichment.js, delivery lifecycle in jobs.js.\n- Persistent migrations and restart recovery: persistence test reopens the file, checks the stored lead, session, idempotency record and an interrupted delivery recovered to pending.\n- Atomic background delivery intent: outbox failure test injects a SQL trigger failure and proves both lead and job roll back.\n- Idempotency: five concurrent same-key submissions produce one lead/job; changed payload returns 409.\n- Background retries + alert: notification test advances due times, verifies dead-letter status and structured alert, then retries successfully.\n- Secret handling: salted password hashes and hashed session tokens asserted in auth test; source ignores .env and data files. Demo credentials are deliberately public.\n- Runtime AI cost attribution: not applicable; application makes no AI API calls.\n- Consent, lead status, export/delete: dashboard and CSV formula-injection tests.\n- Targeting and Shadow DOM: implemented in public/widget.v1.js; browser verifies rendered form and successful submit, not every targeting combination.\n- Live dashboard: ${browser?.passed?'browser check verifies SSE increments the metric automatically.':'browser evidence is not yet available; do not claim this check passed.'}\n\n## Browser verification\n\n${browser?.passed?`Recorded ${browser.date}, browser ${browser.browser}. [Machine-readable results](docs/evidence/browser-results.json).\n\n${browser.checks.map(c=>'- PASS: '+c).join('\n')}\n\n${browser.screenshots.map(f=>'['+f+'](docs/evidence/'+f+')').join(' · ')}`:'Not recorded. Run the optional browser check described in README.'}\n\n## Honest outstanding evidence\n\nPublic GitHub publication, historical phase commits, portal submission and a successful hosted CI run have not been performed. Docker Desktop engine was unavailable, so no container build/runtime success is claimed. Real geo providers and real email delivery are not acceptance evidence; deterministic provider adapters and console delivery are used. Seeded dashboard history is fictional and is not proof of live traffic.\n`;
  writeFileSync(new URL('../EVIDENCE.md',import.meta.url),report);
  console.log('Wrote EVIDENCE.md with actual API output and available browser proof.');
}
