# Voltronix CRM

Next.js and Express share one project root, dependency installation and lockfile. Next.js lives in `src/`, Express in `server/`, and browser-safe contracts in `shared/contracts/`. This repository contains current application source with clean history; legacy PHP history, customer records, uploads and private environments are excluded.

## Install, build and run

Use Node.js **24.x**. From the root:

```sh
npm ci --ignore-scripts --include=dev --no-audit --no-fund
npm run build
npm start
```

Open http://127.0.0.1:3001; Express listens on 127.0.0.1:3002. Development uses `npm run dev`. Optional distinct ports: `npm start -- --web-port=3301 --api-port=3302`. Build on the destination operating system; do not copy Windows native dependencies to Linux. Dependency lifecycle scripts are skipped by the installation command; platform-specific native requirements must be verified separately.

Default startup deliberately selects no database, reads no private `server/.env`, connects no Zoho account and seeds no records. Login HTML and liveness work; database readiness and protected API workflows return unavailable. The home page requires persistence. This is **not production-ready**, and credentials alone cannot complete the remaining shared legacy-MySQL/Zoho integration work.

## Configuration and checks

Four reviewed environment templates exist: the root and `server/.env.example` for older local/native workflows, and separate `deploy/ubuntu/bills-web.env.example` and `deploy/ubuntu/bills-api.env.example` for the HTTPS Bills foundation. Real environments, profiles and credentials must remain private and outside the Bills release. Bridge settings are server-only, never browser-public credentials. Do not enable Zoho synchronization or use database/operator commands as part of default startup.

For `https://bills.voltronix.ae`, use the [manual deployment guide](docs/manual-deployment-guide.md) and `npm run bills:build`, `bills:check:api`, `bills:check:web`, `bills:start:api`, and `bills:start:web` with their explicitly loaded service environments. These commands require database access disabled and a matching API identity; they have no implicit ports or demo fallback. Example ports 3301/3302 require manual availability checks. The local default commands above are not the HTTPS deployment entry points.

The [legacy compatibility audit](docs/legacy-production-compatibility.md) records why the native MySQL adapter cannot be pointed at historical PHP tables. No legacy runtime adapter is implemented. Historical schema, authentication, ownership and business rules need authoritative offline evidence before activation can be designed.

```sh
npm run lint
npm run typecheck
```

Tests and operational tooling are retained in the source, but some suites require intentionally excluded private original files or quotation PDF marks. A source-only checkout cannot pass those suites or issue original-branded PDFs without separately provisioned private inputs. Historical publication/preservation auditors require the retained original workspace; this repository does not contain its Git objects. Do not commit private files to satisfy these checks. No default account or customer/demo database is provided.

## Scope and remaining work

The application implements dashboard/pipeline, products/deals, quotations/PDFs, jobs/departments, reports/exports and users/permissions. Real authenticated workflows require persistence and acceptance. HTTPS configuration, isolated listener checks and Bills-specific service/Nginx templates are prepared locally; deployment, certificate/DNS validation, shared-MySQL compatibility, live Zoho synchronization, file reconciliation, backup/recovery and concurrency acceptance remain unfinished.

Only selected public UI assets and font files/notices are included. Company PDF backgrounds, signatures and stamps, customer uploads, the original-upload-derived favicon and internal asset provenance are excluded. No new application redistribution license or asset-rights determination is made by this source publication. Deployment templates are reference material only; pushing source does not deploy services or authorize database operations.
