# Voltronix Bills CRM

Private application source for the new CRM. This repository has a clean history and deliberately excludes real environments, credentials, customer data, databases, uploads and the original PHP repository. It is source preparation, not a production deployment or a complete copy of the existing CRM's business state.

## Current scope

- `frontend/`: Next.js interface and protected same-origin Express bridge.
- `backend/`: Express/TypeScript API, guarded MySQL preparation and isolated SQLite demo tooling.
- `shared/contracts/`: browser-safe API contracts.
- `tools/`: source-publication and packaging checks.

Zoho OAuth setup, read-only metadata checks and guarded Zoho-to-local imports of Products, Deals and related Notes are implemented. Imported records are read-only snapshots. Re-import does not overwrite a changed source record or propagate deletions. It is not continuous synchronization or a complete migration of users, department assignments, Accounts clearance, attachments, quotation history or completed jobs. The dashboard identifies unavailable operational data rather than presenting it as verified zero.

Production integration with the existing CRM's shared MySQL schema is still pending server-side schema/version verification, compatible adapter work and acceptance testing. Connecting the database or setting an enable flag alone does not complete that integration. Running both CRMs against live data also requires verified concurrency, record ownership and a single coordinated synchronization strategy. Keep automatic Zoho synchronization disabled until those requirements are satisfied.

## Install and build

Use Node **24.x** and the committed lockfiles. Run these commands from the repository root. Install dependencies on the destination operating system; do not copy Windows `node_modules` to Linux.

```sh
npm --prefix shared/contracts ci
npm --prefix backend ci
npm --prefix frontend ci
npm --prefix shared/contracts run build
npm --prefix backend run build
npm --prefix frontend run build
npm --prefix backend run typecheck
npm --prefix backend run demo:sqlite:typecheck
npm --prefix frontend run typecheck
npm --prefix backend run lint
npm --prefix frontend run lint
```

On Windows with npm 11.17, the frontend install can unnecessarily invoke `node-gyp` for `better-sqlite3` and fail when Python is absent, despite that package shipping a compatible native prebuild. For this case, use the package-local workaround below, then rerun the build and test checks above. It does not change global npm settings. The pinned package's bundled Windows x64 prebuild was verified using an in-memory database; no existing dependency binary needs to be copied.

```sh
npm --prefix frontend ci --ignore-scripts
node -e "const Database=require('./frontend/node_modules/better-sqlite3'); const db=new Database(':memory:'); console.log(db.prepare('select 1 as ok').get()); db.close()"
```

`--ignore-scripts` skips dependency lifecycle scripts, not just SQLite's, so successful compilation and tests remain necessary. If a target platform has no compatible bundled native dependency, provision its supported native build prerequisites separately; do not reuse a binary from another operating system or architecture.

The three packages have independent lockfiles. Backend and frontend use the local shared-contracts package; their build scripts also rebuild it. Building does not start a service, connect a production database, import customer data or authorize a deployment.

## Portable offline tests

Tests use synthetic records and mocked external services. Some browser fixtures require Playwright Chromium:

```sh
node frontend/node_modules/playwright/cli.js install chromium
```

The following PowerShell selection runs the portable test files while explicitly excluding suites that require the omitted private originals or quotation images. These exclusions are not passes, and do not certify PDF issuance or source-to-source visual parity.

```powershell
Push-Location backend
$backendTests = @(Get-ChildItem tests -Filter *.test.ts | Where-Object Name -NotIn @('crm-quotation-pdf.test.ts', 'mysql-target-writes.test.ts') | ForEach-Object FullName)
node --import tsx --test @backendTests
$demoTests = @(Get-ChildItem demo-sqlite -Filter *.test.ts | Where-Object Name -NotIn @('historical-harness-reproduction.test.ts', 'workflow.test.ts') | ForEach-Object FullName)
node --import tsx --test --test-skip-pattern='REAL SQLITE both quotation templates render private PDFs' @demoTests
Pop-Location

Push-Location frontend
$privateInputTests = @(
  'attachments-source-layout.test.ts', 'catalog-source-layout.test.ts',
  'commercial-persistence.test.ts', 'department-work-layout.test.ts',
  'job-source-details-layout.test.ts', 'jobs-source-actions-layout.test.ts',
  'navigation-source-labels.test.ts', 'pipeline-entry.test.ts',
  'preserved-font-notice.test.ts', 'quotation-pdf.test.ts', 'work-log-date.test.ts'
)
$frontendTests = @(Get-ChildItem tests -Filter *.test.ts | Where-Object Name -NotIn $privateInputTests | ForEach-Object FullName)
node --import tsx --test @frontendTests
Pop-Location
```

Check each command's exit status; a later success does not erase an earlier failure. On other shells, pass the equivalent selected test file paths to `node --import tsx --test` from each package directory. Browser evidence is written to ignored local report directories.

The unfiltered `test` and `demo:sqlite:test` commands retain historical/private-input tests and are not a fresh source-only checkout acceptance command. Likewise, `verify:boundaries` requires the complete privately provisioned quotation asset set; historical preservation/source-verification scripts require private originals. Live MySQL/HTTP acceptance commands require their separately approved fixtures and configuration. Do not add private originals or business records to Git to make any of these checks pass.

## Local configuration and demo

Only `backend/.env.example` and `frontend/.env.example` are committed environment templates. Create real configuration privately when needed. Do not commit it, paste tokens into issues, or place secrets in browser-public variables.

The backend reads its own `.env`, with explicit process settings taking precedence. Its minimal API settings are `CRM_API_ENVIRONMENT`, `CRM_API_HOST`, `CRM_API_PORT` and `APP_ORIGIN`. The example disables MySQL network access. API settings alone provide a liveness foundation, not a configured CRM database.

The frontend Express bridge uses server-only `CRM_FRONTEND_BACKEND=express`, `CRM_EXPRESS_ORIGIN` and `APP_ORIGIN`; no `NEXT_PUBLIC_*` credential setting is needed. The isolated SQLite launcher supplies its own local process settings and does not silently initialize, reseed or overwrite an existing database.

For a deliberately new, synthetic local demo after building, ensure ports 3001 and 3002 are free, then run:

```sh
npm --prefix backend run demo:sqlite:init
npm --prefix backend run demo:sqlite:start
npm --prefix backend run demo:sqlite:status
```

Use the private local access-file location reported by initialization for generated test-account details. No default login or real user account is supplied by the source repository. Open `http://127.0.0.1:3001`. Stop only the owned demo with `npm --prefix backend run demo:sqlite:stop`. Initialization refuses existing or partial demo state; inspect retained evidence rather than deleting it or rerunning a seed. This demo is not a production service, and private quotation images are still required for successful PDF issuance.

Zoho setup/check/import commands require owner-provided private OAuth configuration and an intentional organization choice. A successful token exchange or metadata read does not enable background synchronization or prove all production workflows. Review import previews before explicitly applying them; preserve existing local data and never treat a changed-source warning as permission to overwrite it.

## Private assets and production acceptance

Company quotation backgrounds, handwritten signature/stamp images and the historical favicon are not included. The existing reviewed public logo supplies the browser icon instead. Licensed font files and their notices are retained. For authorized PDF use, provision the approved image files out of band into the package-owned quotation asset directories, following the renderer and deployment asset inventory. Keep those images ignored, confirm supported issuer details, and verify generated PDFs privately before issuance. Do not substitute an arbitrary signature or stamp, and do not publish one to fix a missing-asset test.

The deployment runbooks describe additional host, TLS, private-storage, account, backup/restore and MySQL acceptance requirements. They include historical preparation checkpoints for the new native schema, not acceptance evidence for the legacy shared database or this checkout. Some instructions reference owner-retained internal runbooks or original source intentionally absent here. For current environment loading, use the backend production-environment guide rather than older JSON-only assumptions. Preserve authentication, authorization, CSRF, concurrency, protected downloads and file/PDF restrictions during integration.

Publishing clean source does not revoke credentials exposed in an older repository or erase copies held elsewhere. Handle provider-side rotation and old-repository remediation separately. Keep this repository private; no open-source license or permission to redistribute company branding or third-party assets is implied.
