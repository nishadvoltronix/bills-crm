# Bills CRM local production preparation

Prepared 2026-10-17 from `544433b2e1549a223ce89c70f9bf7b17577bbed2`, on the uncommitted branch `codex/bills-production-prep` in `G:\crm.voltronix.ae\release\bills-production-prep-20261017`.

**The database-disabled foundation builds and runs locally. This is not production readiness or a functioning historical CRM. No legacy database adapter has been implemented. No server, live website, production database or Zoho service was contacted. No deployment, migration against an existing database, commit or push was performed.**

## Result and architecture

Next.js in `src/`, Express in `server/src/`, and shared contracts in `shared/contracts/` use one root project directory, `package.json`, lockfile and dependency installation. There is no nested API package installation or separate npm workspace build. Node 24 is required. Contracts compile to `shared/contracts/dist`, Express to `server/dist`, and Next to `.next`; the two HTTP processes run separately from the same release directory. Build on the target Linux architecture rather than transferring Windows dependencies/build output.

The new `tools/run-bills.mjs` validates explicit settings, rejects active dotenv files and database/integration selectors, checks build outputs and listener availability, and starts the API with no database/authentication/CRM service injected. It does not invoke the native MySQL CLI, create accounts, run migrations or seed data. A missing or invalid setting fails before startup. Interrupted builds stop before later build stages. Listener conflicts never cause port hopping or termination of another service.

The HTTPS web process verifies API identity at startup and before each forwarded request. The expected service, instance and canonical origin must match before cookies, CSRF headers or request bodies are forwarded. Identity probes carry no browser credentials, reject redirects, and have a two-second deadline and 4 KiB limit. This prevents accidental routing to a different local application; it is not cryptographic authentication of a hostile local process. Existing authorization, cookie filtering, CSRF rules and percentage-only quotation calculations were retained.

Live checks demonstrated API liveness/identity 200, readiness 503, login HTML/assets 200, and authentication plus representative dashboard/leads/deals/pipeline/items/quotations/jobs/settings/attachment endpoints 503 without persistence. A second API launch rejected the occupied port while its original owner stayed running. After replacing the owned test API with a wrong-identity service, that service received only the identity GET, with no browser cookie or login body. Local HTTP checks with an HTTPS application origin do not prove TLS/certificate behavior.

## Final verification

| Check | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| `npm run test:server` | 883 | 0 | 0 |
| `npm run test:demo` | 224 | 0 | 0 |
| `npm run test:web` | 479 | 0 | 0 |
| `npm run test:tools` | 74 | 0 | 0 |
| `node --test tools/bills-foundation-smoke.mjs` after the build | 8 | 0 | 0 |
| **Total, without adding overlapping focused reruns** | **1,668** | **0** | **0** |

`npm run lint`, `npm run typecheck` (contracts, web, server and demo), the Bills production build, targeted JavaScript lint/syntax checks, and `git diff --check` passed. The 43 legacy checks, authentication/authorization/contract tests, PDF and percentage-discount tests, identity checks, and 32 publication/package tests are included in the suite totals above. The six deployment-template checks are static checks, not execution of Nginx or systemd on Ubuntu.

Initial verification exposed missing intentionally excluded private reference files: the first server run passed 856 and failed 27. Thirty-six required source/asset reference files were copied only into ignored paths in this isolated checkout; no database, environment, profile, session or customer-upload files were copied. All 36 original and copied SHA256 values were rechecked after testing and unchanged. The full server/demo/web suites then passed with no weakened assertions. Tests used isolated synthetic/in-memory data and owned loopback services; they did not use any existing database. A clean public checkout still needs those private references to repeat every preservation/PDF test.

Two test-development issues were corrected: the initial smoke expected a nonexistent `/api/leads` GET rather than the implemented `/api/leads/1` route (6 passed, 2 failed including its parent test); a new hard-link test first hit the stricter unknown-path guard before the intended link guard (73 tools tests passed, 1 failed). Final reruns above pass. An inherited `DEBUG` variable was correctly rejected by the initial build preflight; it was removed from that build process environment before the successful build.

Local evidence stays ignored under `release/`: `production-build.log`, `lint.log`, `typecheck.log`, `offline-suite-results.json`, `offline-{server,demo,web}-tests.log`, `tools-tests.log`, `foundation-smoke.log`, `test-private-inputs.json`, `test-private-inputs-postcheck.json` and package verification receipts. Browser/synthetic test artifacts remain ignored under `.local-data/`. Dependencies, compiled outputs, private references and private test reports are not part of the source archive or proposed commit.

Dependency lifecycle scripts were disabled during the offline lockfile installation; no package versions or lockfile changed. The installed SQLite prebuild worked for isolated tests without copying or compiling a native binary. No saved vulnerability-advisory report was available and no online audit was run under the local-only scope. **Current dependency vulnerability counts remain unverified**; successful tests are not a dependency security audit. Linux-native dependency/build acceptance remains required.

## Package and preservation

`tools/prepare-bills-package.mjs` captures the complete reviewed source/configuration/test inventory and 34 pinned public/font assets. It creates a new `release/bills-source-<UUID>/` containing `bills-crm-source.zip`, its SHA256 file, and the source tree with `FILE-MANIFEST.json`. It checks current source bytes, copied files, deterministic ZIP entries, checksums, manifest and absence of extra files/directories. Missing required files, symlinks, hard links, unknown source paths, malformed templates and unreviewed credential findings fail closed.

The source manifest records every included file and hash. Actual environment files, secrets, Git history, dependencies, builds, databases, uploads, sessions, backups, PHP originals, private PDF marks, the private legacy manifest and original-upload-derived favicon are excluded. Exactly four reviewed nonsecret example environment templates are included. Test credential exceptions are bound to reviewed synthetic content by exact file, hash and finding category; runtime source has no such exemption.

Generic/pinned-source checks passed. An additional read-only scan against the original local Git history's known Zoho credential and exact private-file fingerprints passed with zero findings; no secret values were printed. That extra local scan is distinct from the standalone package CLI, whose manifest accurately reports that historical scanners are not supplied by default. Pattern/fingerprint checks cannot prove that unknown or transformed private material is absent. Final package receipts and hash are recorded outside the archive to avoid a self-referential manifest.

The original `G:\crm.voltronix.ae` source, PHP, user changes, databases and uploads were not edited. Its original HEAD remains `851e0a3124bd137a8291fe96e9350fbd45e56dbb`. All proposed source edits are in the isolated worktree; its HEAD remains the base commit, and no remote operation occurred in this task. The older deployment archive and the previously published clean checkout were not overwritten.

## Remaining blockers and required settings

The [legacy audit](legacy-production-compatibility.md) documents the 42 PHP source references, table/identity/permission/file/quotation mismatches and exact missing evidence. No authoritative production DDL was found in the scoped local search; the available SQLite scaffold explicitly says it is inferred. Native MySQL sessions, throttle records, versions, locks, audit logs and BLOB contracts differ. Native login itself requires writes, so a read-only connection does not make the native adapter compatible.

Required before historical CRM acceptance: authoritative offline schema and deployed PHP revision; sanitized representative relational fixtures and identity/status/permission rules; password/session compatibility; preserved quotation revisions/totals and concurrency semantics; attachment bytes/ownership/allowed roots; isolated recovery and side-by-side acceptance. A separately approved session/audit architecture may be needed to keep the old database unchanged. Do not run native migrations against it or enable a second Zoho writer. Login, authenticated CRM records, persisted PDFs, protected downloads and settings cannot work in the current disabled mode; Zoho-dependent features remain disabled too.

Both services require `NODE_ENV=production`, `APP_ORIGIN=https://bills.voltronix.ae`, `CRM_API_INSTANCE_ID=bills-crm`, `CRM_DATABASE_MODE=disabled`, `CRM_MYSQL_NETWORK_DISABLED=1`, `ZOHO_ENABLED=false`, and `NEXT_TELEMETRY_DISABLED=1`.

Web additionally requires `CRM_FRONTEND_BACKEND=express`, `CRM_WEB_HOST=127.0.0.1`, `CRM_WEB_PORT=3301`, and `CRM_EXPRESS_ORIGIN=http://127.0.0.1:3302`. API additionally requires `CRM_API_ENVIRONMENT=production`, `CRM_API_HOST=127.0.0.1`, and `CRM_API_PORT=3302`. IPv6 loopback is supported by configuration, but actual IPv6 listener acceptance was not run. **3301/3302 are examples requiring host verification; 3001/3002 are already occupied.** See the [environment contract](backend-production-environment.md).

The [manual deployment and rollback runbook](manual-deployment-guide.md) supplies exact future build, checksum/transfer/extraction, backup verification, app-local Node, isolated release/service, Nginx test, health-check and rollback steps for `/var/www/bills.voltronix_ae`. Actual host capacity/ports/users/systemd/Nginx, DNS, certificates/renewal, private PDF assets and backup/recovery evidence remain unverified. No command from that server runbook was executed.

## Exact proposed source changes

Modified (32):

```text
.env.example
.gitignore
README.md
deploy/ubuntu/nginx.conf.example
docs/backend-production-environment.md
docs/final-release-checklist.md
docs/manual-deployment-guide.md
docs/mysql-production-operator-guide.md
docs/staging-acceptance.md
package.json
scripts/frontend-configuration.ts
server/src/app.ts
server/src/config.ts
server/src/environment.ts
server/src/runtime/configuration.ts
server/tests/config.test.ts
server/tests/configuration-command.test.ts
server/tests/environment.test.ts
server/tests/http.test.ts
server/tests/production-runtime.test.ts
server/tests/runtime-configuration.test.ts
shared/contracts/src/index.ts
src/server/config/frontend-backend.ts
src/server/express-bridge.ts
tests/express-https.test.ts
tests/frontend-environment.test.ts
tools/audit-publication.mjs
tools/audit-publication.test.mjs
tools/deployment-templates.test.mjs
tools/publication-reviewed-fixtures.json
tools/run-local.mjs
tools/run-local.test.mjs
```

Added (13):

```text
deploy/ubuntu/bills-api.env.example
deploy/ubuntu/bills-crm-api.service
deploy/ubuntu/bills-crm-web.service
deploy/ubuntu/bills-web.env.example
docs/legacy-production-compatibility.md
docs/production-preparation-report.md
server/tests/legacy-compat-runtime-refusal.test.ts
tests/express-identity.test.ts
tools/bills-foundation-smoke.mjs
tools/prepare-bills-package.mjs
tools/prepare-bills-package.test.mjs
tools/run-bills.mjs
tools/run-bills.test.mjs
```

Replaced old service templates (2 deletions in this isolated checkout only):

```text
deploy/ubuntu/voltronix-crm-api.service
deploy/ubuntu/voltronix-crm-web.service
```

Runtime/config changes establish the disabled Bills entrypoints and API isolation; test changes verify those boundaries; packaging changes enforce reviewed files/bytes; templates/docs describe the actual limitations and isolated operator procedure. Existing PHP and legacy artifacts are outside this diff.

## Proposed Git commands: not executed

Review the exact 47-path list in the locally generated ignored `release/commit-paths.txt` and the diff before approval. It includes only the files listed above, including the two replaced service templates. The commands below stage and commit only that list, then push the new preparation branch to the existing `bills-crm` remote. They do not operate on the original legacy repository, amend the old commit, force-push or deploy. This repository was previously confirmed public; keep private references, logs and archives excluded.

```powershell
Set-Location -LiteralPath 'G:\crm.voltronix.ae\release\bills-production-prep-20261017'
git status --short
git diff --check
Get-Content -LiteralPath release/commit-paths.txt
git add --pathspec-from-file=release/commit-paths.txt
git diff --cached --stat
git diff --cached --check
git commit -m "Prepare isolated Bills CRM foundation and document legacy blockers"
git push -u origin codex/bills-production-prep
```

No staging, commit or push in this block has been executed. Run only after reviewing and approving the proposed changes.
