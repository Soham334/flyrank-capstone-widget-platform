# Build log and AI disclosure

## 2026-11-01 · AI-assisted initial implementation

Codex read the supplied capstone brief, inspected the existing assignments workspace, and generated this self-contained capstone folder. AI assistance covered the design, backend, migrations, owner dashboard, widget embed, customer test site, tests, Docker/CI recipes and documentation. The work was not independently handwritten by the student. The student still needs to read, understand, adapt, and own the code before submitting it.

Concrete corrections made during verification:

- The first HTTP test run was blocked by the desktop sandbox's loopback network restrictions. It was rerun with reviewed execution outside that sandbox; no product test was weakened to hide the environment issue.
- Browser QA found a missing closing anchor tag in the sidebar that caused incorrect browser DOM repair and broken layout. The markup was fixed and rechecked.
- Mobile QA found CSS grid children expanding to the table's intrinsic width. Explicit minimum widths were corrected and the 390px overflow assertion was retained.
- SQL was moved from HTTP handlers into an explicit tenant-scoped repository to make the persistence boundary inspectable.
- Migration startup was changed to apply numbered versions only once within transactions.
- Oversized-body iteration preserves the request stream long enough to return a clean JSON 413 response.
- Browser QA was extended to verify automatic SSE metric updates, not just navigation to newly stored leads.

Seeded people, countries, historical deliveries, and example credentials are clearly labeled demo fixtures. Test reports and browser screenshots are generated from real local checks; the evidence generator refuses to claim acceptance when the test process fails.

No external AI API is called by the application. Per-call AI attribution and budget enforcement are therefore not applicable to runtime operation. This log does not make claims about the cost of the development assistant.

## Outstanding student-owned steps

- Review the source, run the app and checks, and add your own design explanations and meaningful improvements.
- Create a dedicated public GitHub repository, preserve honest future commits, and submit its URL through the portal.
- Run Docker verification when Docker Desktop's Linux engine is available, and record its actual output.
- If adding real email, geo, hosting, or AI services, document privacy/quotas/secrets and replace the demo adapters deliberately.

No earlier phase history, independent implementation, successful CI run, real email delivery, or Docker execution is asserted. A dedicated public source repository was initialized during deployment preparation; its actual commits document publication.

## 2026-11-02 · Free hosting preparation

Added an optional async Postgres repository, TLS-capable pg driver, Postgres schema migration, Render Free blueprint, secure-cookie/proxy settings and configurable customer-demo URL. Without DATABASE_URL the original local SQLite mode remains available. Render startup refuses to use ephemeral SQLite so leads are not silently lost on restarts.

The existing 17 HTTP tests passed after async repository integration. Remote Postgres and deployment verification remain outstanding until hosting/database accounts are connected. Browser setup stopped because the automation system could not verify the current URL; no browser account or repository mutation was performed.
