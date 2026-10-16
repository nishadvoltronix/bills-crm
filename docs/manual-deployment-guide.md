# Manual Ubuntu 24.04 deployment — Voltronix CRM

**Future owner-operated procedure, not deployment approval.** No server, provider, DNS, firewall or production database was contacted while preparing this guide. Every Ubuntu/MySQL/Nginx/systemd/TLS/backup command here is **NOT RUN on the target**. Complete isolated staging acceptance and the [final release checklist](final-release-checklist.md) before production cutover. The existing Windows SQLite demo must not be converted, reset, imported or used as a test account source.

Selected architecture: **Nginx HTTPS → Next.js on 127.0.0.1:3001 → Express on 127.0.0.1:3002 → co-located Oracle MySQL 8.4.11 on 127.0.0.1:3306 or 3308**. Process manager: **systemd only**, with separate API/web Unix users. PHP is not a runtime dependency. This first production contract deliberately does not support remote MySQL; do not substitute a managed database or disable TLS requirements to make a remote connection work. A remote DB requires a separately implemented and accepted TLS/identity contract.

**2026-10-15 shared-database override:** the owner now wants both `crm.voltronix.ae` and `bills.voltronix.ae` using the existing legacy database concurrently. This guide describes the **native-schema** runtime; its database provisioning/migration/startup instructions are **not applicable to that legacy schema yet**. Follow the [local compatibility preparation/server handoff](post-demo-mysql-zoho-plan.md#shared-database-preparation) first. No legacy runtime adapter is implemented, and no native migration must be applied to the existing live CRM to force compatibility.

## 1. Owner preflight: do not install or stop anything yet

Read-only commands on the intended Ubuntu host, manually, after confirming administrative access:

```bash
cat /etc/os-release
uname -m
id
free -h
df -hT
df -i
ss -ltnp
systemctl --type=service --state=running
node --version
npm --version
nginx -v
mysql --version
timedatectl status
```

Missing commands are prerequisites, not permission to install a random package or replace another workload. Record current services, port owners, resource headroom, disk/mount lifecycle, existing firewall/remote-access policy and backup arrangements privately. No fixed RAM/disk recommendation substitutes for measured build/upload/concurrent-write load. Do not terminate an unrelated process using 80/443/3001/3002/3306/3308. Reserve the selected ports or resolve the conflict through its owner.

Both package manifests require **Node >=24.0.0 <25**. This workspace verified Node 24.19.0; use an approved supported 24.x build and all three lockfiles. Ubuntu's default Node/MySQL packages are not assumed to satisfy the pinned versions. Obtain Node and Oracle MySQL 8.4.11 through an independently approved installation/provenance procedure; verify versions before proceeding. Do not substitute MariaDB or change the runtime version check. Network installs, registry audits and OS package updates require the owner's separate approval and maintenance plan.

Confirm whether the historical domain `bills.voltronix.ae` is actually the production hostname. The template hostname **`crm.example.invalid` is deliberately not deployable**. Select a separate staging DNS name, actual DNS control, LAN/public addressing and certificate plan. Office Internet may use CGNAT or block inbound ports: verify with the network owner/ISP; do not assume a public address or enable port forwarding blindly. VPN/internal-only access is preferable until external exposure is explicitly approved. DNS, NAT, firewall and certificate changes below are owner actions, never agent actions.

## 2. Runtime candidate and asset boundary

Local cleanup does not make the development workspace deployable wholesale. The only pre-existing file removed was the reproducible `frontend/tsconfig.tsbuildinfo` cache, with a verified private recovery copy. A separate 858-file temporary source/build copy created during cleanup was removed after a successful isolated build, retaining its source package, build log and removal manifest; dependency targets were untouched. Original/private data, historical reports, tests, dependencies and live build outputs remain deliberately retained. The repository's cleanup inventory/readiness record holds exact fresh results and final candidate identity separately. Keep `shared/contracts/`, `deploy/ubuntu/` and package lockfiles: the architecture requires more than frontend/backend alone. Do not transfer `.git`, `.local-data`, `.local-dev`, `.private-legacy`, `nextjs` private inputs or original `assets` trees. Every new documentation/source change requires a newly verified candidate; prior candidates remain immutable evidence.

The separate `release/runtime-<UUID>/` source candidate contains `frontend/`, `backend/`, `shared/contracts/`, `deploy/ubuntu/`, deployment/checklist documentation and `runtime-manifest.json`. It contains pinned package manifests/lockfiles, source, backend versioned migrations and the compiled-operator source. It does **not** contain Git history, actual env/profiles, credentials, customer files, databases, originals/PHP, private evidence, backups, logs, tests, node_modules, Windows binaries or generated builds. Only supported build/start/operator scripts remain in generated application manifests; dependency graphs/lockfiles are unchanged.

**Asset provisioning is OWNER TO CONFIRM and blocks visual/PDF release acceptance.** All `frontend/public/`, `frontend/assets/` and `backend/assets/` are deliberately excluded; original files remain untouched. This includes theme CSS/icon fonts, login/department/branding images, favicon, PDF fonts/notices, backgrounds, signature and stamp. Do not copy an entire original upload directory. Obtain rights and review an exact asset manifest; provision only those approved bytes at their existing paths. Required template assets include `backend/assets/quotation-pdf/{databg.png,switchgear_bg4.png,sign.jpg,stamp.jpg,Roboto-Regular.ttf,Roboto-Bold.ttf,Roboto-LICENSE.txt,DejaVuSansCondensed.ttf,DejaVuSansCondensed-Bold.ttf,DejaVuinfo.txt}`; font notices must accompany fonts. Frontend layout references six local theme stylesheets under `frontend/public/legacy/assets/css/` and corresponding images/fonts; inspect the excluded-assets inventory beside the package before approving them. Missing assets are not replaced with fabricated business branding.

The candidate is **not GitHub publication approval**. Known-secret/generic-secret and file-boundary checks are useful but not proof of absence of every unknown/encoded secret. An independent exact-export review remains mandatory. Never transfer the working repository, `.git`, a Git bundle, backups or its private archive as the deployment artifact.

## 3. Directories, service users and build

The following are future mutating owner commands, after a non-production staging host and unused paths are approved. Substitute real approved release IDs/paths; do not run placeholder commands. Check each intended user/path is absent before creation; if it exists, inspect ownership/purpose instead of modifying it.

```bash
# Owner reviews existing identities and paths first:
getent passwd voltronix-crm-api
getent passwd voltronix-crm-web
test ! -e /srv/voltronix-crm
test ! -e /etc/voltronix-crm
# Only if creation is approved and these identities do not exist:
sudo useradd --system --no-create-home --shell /usr/sbin/nologin voltronix-crm-api
sudo useradd --system --no-create-home --shell /usr/sbin/nologin voltronix-crm-web
sudo install -d -m 0755 -o root -g root /srv/voltronix-crm/releases
sudo install -d -m 0700 -o root -g root /etc/voltronix-crm
```

Unpack/copy only the verified source candidate into a **new** immutable release directory, using a non-root build user in a separate build area. Never overlay a running release. Review manifest hashes and rejects before build; retain the source manifest and approval. Use a trusted registry/lockfile policy; installation executes dependency lifecycle scripts and requires separate authority. Do not copy Windows node_modules to Ubuntu.

Run sequentially in that new release/build root, stopping at every failure:

```bash
set -euo pipefail
export NEXT_TELEMETRY_DISABLED=1
npm --prefix shared/contracts ci --no-audit --no-fund
npm --prefix backend ci --no-audit --no-fund
npm --prefix frontend ci --no-audit --no-fund
npm --prefix backend run build
# Set the three reviewed frontend values from section 4 before its build:
npm --prefix frontend run build
# Production runtime needs no TypeScript/test tools after successful builds:
npm --prefix backend prune --omit=dev --no-audit --no-fund
npm --prefix frontend prune --omit=dev --no-audit --no-fund
```

Do not overlap shared-contract builds. The final release includes compiled `backend/dist` and `shared/contracts/dist`, frontend `.next` and Linux production dependencies. Keep shared/contracts present because both packages use the local linked package. Native SQLite dependencies remain part of retained Next source compatibility; Express production guards prohibit direct frontend DB use. Review dependency/license/vulnerability findings using the approved registry before accepting a release; no external vulnerability scan was performed here.

Install the reviewed build as root-owned source/runtime files, readable by the services, not generally writable by them. Only the web `.next/cache` and explicitly approved private state/log destinations are writable. Do not recursively change ownership of an existing server workspace. Stage a new `current` symlink only after approval; private runtime files themselves and their `.local-data/operators` directories must be ordinary physical files/directories, never symlinks. Use the physical release path for profile validation/operator commands.

## 4. Exact environment and private JSON configuration

**Updated production alternative:** the owner selected `https://bills.voltronix.ae`; DNS/TLS has not been checked. The [backend environment contract](backend-production-environment.md) provides the complete template for `CRM_RUNTIME_SOURCE=environment`, with credentials, UUID, actual approval references and issuer validated through the same production validator. Do not mix those fields with `CRM_RUNTIME_PROFILE`. The private JSON instructions below remain supported as an alternative, not the only credential source. Zoho credential keys are recognized only while disabled; live sync remains unimplemented and enabling it refuses startup. Keep actual local-demo configuration unchanged. This option does not alter migration-operator authority or approve a real connection.

**Do not copy this workspace's real env or profiles.** The SQLite launcher still supplies its existing fixed local settings and requires no new env. Templates remain safe local examples. The table below describes the seven backend/three frontend settings for the JSON option; the linked environment alternative adds explicit backend-only MySQL/disabled-Zoho keys. No root env, browser-public CRM key, session-secret or upload-path setting is required.

For systemd, create private **server-side** `/etc/voltronix-crm/backend.env` and `/etc/voltronix-crm/frontend.env` using an approved editor/secret-delivery workflow. These are future owner-created files, not files created by this task. systemd reads them before dropping privileges; mode 0600, owner root. Normal independent backend CLI also supports `<physical-release>/backend/.env` anchored at the executable, but do not maintain duplicate files unnecessarily: process environment wins, and absence of that package file is supported. Next accepts process settings or its own package dotenv file; the units use process settings. Never put DB credentials in frontend or `NEXT_PUBLIC_*`.

| Name | Service; required? | Value/source | Missing or invalid |
| --- | --- | --- | --- |
| `CRM_API_ENVIRONMENT` | Backend; required | `production` for the production contract, including its isolated staging exercise | Refused; no silent mode inference. |
| `CRM_API_HOST` | Backend; required | `127.0.0.1` | Refused; API cannot bind publicly. |
| `CRM_API_PORT` | Backend; required | `3002` in supplied units; explicit permitted port 1024–65535 | Refused; coordinate any different private port across bridge/proxy/units. |
| `APP_ORIGIN` | **Both** services; required | Owner-approved canonical `https://<dns-host>` at default 443, no path/trailing slash | Startup/configuration refused; origins must match. |
| `CRM_RUNTIME_ENABLE` | Backend; required in production | `approved-production-mysql-crm-runtime` | Production refuses foundation-only or partial selection. |
| `CRM_RUNTIME_PROFILE` | Backend; required | `.local-data/operators/mysql-crm-runtime.json` | Refused; no profile fallback/discovery. |
| `CRM_MYSQL_NETWORK_DISABLED` | Backend; optional safety veto | `1` during offline work; **blank** only in explicitly approved real-target process | `1` prevents startup DB check; removing it is not approval. |
| `CRM_FRONTEND_BACKEND` | Frontend; required in production | `express` | Production refuses direct-Next fallback. |
| `CRM_EXPRESS_ORIGIN` | Frontend; required | `http://127.0.0.1:3002` (no `/api/v1`) | Refused; private loopback upstream only. |
| `NODE_ENV` | Process/unit, not strict backend dotenv key | Units set `production` | Framework mode; not permission to connect to production. |
| `NEXT_TELEMETRY_DISABLED` | Frontend/build process; operational | `1` | Telemetry control, not application authentication. |

Backend environment-file example, **nonsecret placeholders, not an active file**:

```dotenv
CRM_API_ENVIRONMENT=production
CRM_API_HOST=127.0.0.1
CRM_API_PORT=3002
APP_ORIGIN=https://OWNER_APPROVED_DNS_HOST
CRM_RUNTIME_ENABLE=approved-production-mysql-crm-runtime
CRM_RUNTIME_PROFILE=.local-data/operators/mysql-crm-runtime.json
CRM_MYSQL_NETWORK_DISABLED=
```

Frontend environment-file example:

```dotenv
CRM_FRONTEND_BACKEND=express
CRM_EXPRESS_ORIGIN=http://127.0.0.1:3002
APP_ORIGIN=https://OWNER_APPROVED_DNS_HOST
```

The uppercase DNS placeholders are intentionally invalid until replaced by a real canonical lowercase host. Do not use default example domains/identity values to bypass validation.

For the **JSON option**, the API's credential/issuer configuration is one strict private JSON. The environment alternative uses the documented backend-only fields instead; never select both. JSON location: `<physical-release>/backend/.local-data/operators/mysql-crm-runtime.json`. Create `.local-data` and `operators` owned by `voltronix-crm-api`, mode 0700; JSON owned by that same API UID, mode 0600, single-link ordinary file, no BOM/symlink. Canonical JSON is two-space `JSON.stringify(value, null, 2)` plus newline. Deliver only the approved runtime credential, never migration/root authority. Web UID must not read it.

```json
{
  "version": 2,
  "mysql": {
    "provider": "mysql",
    "environment": "production",
    "host": "127.0.0.1",
    "port": 3306,
    "database": "<owner-approved-lowercase-schema>",
    "user": "<owner-approved-runtime-user>",
    "password": "<private-value-from-authorized-operator>"
  },
  "approval": {
    "approved": true,
    "reference": "<actual-approval-reference>",
    "provisioningReference": "<actual-provisioning-reference>",
    "serverUuid": "<actual-verified-server-uuid>"
  },
  "issuer": {
    "company": "<owner-selected-supported-company>",
    "salesperson": "<owner-approved-display-name>"
  }
}
```

These placeholders must fail validation. `company` must be the owner's actual choice of existing supported `VOLTRONIX CONTRACTING LLC` or `VOLTRONIX SWITCHGEAR LLC`; do not select one on the owner's behalf. Salesperson is an explicit approved printable display value, not guessed from an account. New quotations snapshot the supplied issuer; existing quotations are not backfilled/repriced. The long-lived v2 production approval is deployment provenance, not provider authorization. The v1 development/test profile remains separate and retains its ≤24-hour approval limit. Port 3308 is supported only when that is the approved actual local MySQL listener.

Sessions/CSRF use random 32-byte tokens with stored hashes and existing two-hour limits; there is no `SESSION_SECRET`/`JWT_SECRET`. Do not expose cookies/token values in logs or test receipts. Zoho runtime remains unimplemented: only the documented inactive Zoho keys are accepted, and `ZOHO_ENABLED=true` refuses startup. The historically exposed credential must never be used.

## 5. MySQL creation, migration, backup and restore

Follow the source-derived [MySQL production operator guide](mysql-production-operator-guide.md). It supplies exact schema/user constraints, the separate private migration profile, exact least-privilege grant list, identity checks and future backup/restore safety gates. It is part of this manual procedure, not optional background.

Build-stage native commands from the separate approved operator backend, never the live demo:

```bash
npm run mysql:operator -- inspect
# Only after verified backup/rollback/exclusive-write-window approval:
npm run mysql:operator -- migrate --acknowledge-additive-mysql-ddl-and-retained-failures
npm run mysql:operator -- inspect
```

They execute compiled `dist/operations/mysql-cli.js` and work without tsx/dev dependencies. `inspect` verifies identity/privileges/schema; it connects and is not an offline command. Migration never creates accounts, imports/seeds data, drops a schema or repairs partial DDL. Require fresh 3 then 0 or exact-v1 2 then 0; keep interrupted targets for review. Do not run against any existing DB during this development phase. Native MySQL acceptance is **BLOCKED** until an independently approved isolated target exists.

## 6. Nginx, certificates, network boundaries

Review `deploy/ubuntu/nginx.conf.example` and replace **every** `crm.example.invalid` placeholder consistently with the approved staging hostname first. The example exposes Next only; it does not give the public Internet a direct Express or MySQL port. Frontend forwards same-origin API requests internally. Authorization/CSRF use configured origins, not client-supplied forwarded headers; Express keeps `trust proxy=false`. No permissive CORS header is required.

The outer upload cap is 52 MiB to permit the existing bounded multipart overhead; application checks remain authoritative: task/PM 16,384,000 bytes, other four department log files 52,428,800. Never disable validation or increase these limits solely to pass a proxy test. Test real memory/packet/timeout capacity before launch.

Certificate issuance/renewal requires a verified domain, actual DNS/network access and separate owner authority. Do not apply the TLS vhost before its real certificate/key exist. A future approved Certbot example (not executed):

```bash
# First review installed Certbot/Nginx support and the chosen challenge method:
certbot --version
sudo nginx -t
# Only with approved public DNS/reachability and an approved temporary HTTP vhost:
sudo certbot certonly --nginx -d OWNER_APPROVED_DNS_HOST
# Only after the reviewed TLS config and certificate paths are in place:
sudo nginx -t
sudo systemctl reload nginx
sudo certbot renew --dry-run
systemctl list-timers --all | grep -i certbot
```

Do not stop an existing port-80 workload to obtain a certificate. For CGNAT/private sites, choose an authorized DNS challenge or internal CA/VPN plan; DNS API credentials must remain private and need separate approval. Never use a self-signed certificate while claiming public TLS acceptance. HSTS in the supplied template is enabled only after correct HTTPS operation; choose preload/subdomain policy separately (neither is assumed).

Review firewall rules without changing them (`sudo ufw status verbose` where UFW is actually in use). Preserve administrative access and existing policy before any approved future change. Never expose 3001/3002/MySQL externally. Public 80/443 and router NAT changes require an explicit network decision; no universal firewall command is safe on an uninspected office server.

## 7. systemd installation, health and logs

Review the supplied units at `deploy/ubuntu/voltronix-crm-{api,web}.service`. They use `/usr/bin/node` (must be the verified 24.x executable), `/srv/voltronix-crm/current`, separate UIDs, restricted env files, read-only release files, private temp directories, no new privileges, restart-on-failure limits and graceful SIGTERM. Web gets only its cache writable and cannot access backend private configuration. The API opens no public interface. Install only after staged source/assets/profiles/DB and service account permissions are verified.

Future manual commands, **not executed**:

```bash
sudo systemd-analyze verify deploy/ubuntu/voltronix-crm-api.service deploy/ubuntu/voltronix-crm-web.service
# First check destination units are absent or preserve/review their existing versions.
sudo install -m 0644 deploy/ubuntu/voltronix-crm-api.service /etc/systemd/system/voltronix-crm-api.service
sudo install -m 0644 deploy/ubuntu/voltronix-crm-web.service /etc/systemd/system/voltronix-crm-web.service
sudo systemctl daemon-reload
sudo systemctl start voltronix-crm-api.service
curl --fail --silent --show-error http://127.0.0.1:3002/api/v1/health/ready
sudo systemctl start voltronix-crm-web.service
curl --fail --silent --show-error http://127.0.0.1:3001/api/health/live
# Enable boot startup only after acceptance, not merely because processes started:
sudo systemctl enable voltronix-crm-api.service voltronix-crm-web.service
sudo systemctl status voltronix-crm-api.service voltronix-crm-web.service --no-pager
```

`/api/v1/health/live` returns process status `running`; `/api/v1/health/ready` verifies the actual runtime DB/schema/privileges/identity and returns `ready` or redacted 503. Frontend `/api/health/live` bridges to Express. Production CLI checks the DB before opening its listener; foundation-only production startup is refused. A health PASS is not authenticated workflow acceptance. Never log a token to prove a login.

Review restricted journals locally (`sudo journalctl -u voltronix-crm-api -u voltronix-crm-web --since today --no-pager`); do not paste raw logs publicly. Nginx access template omits URI/query/body/cookies and records status/timing only. Critical native/server errors can still include operational detail, so journal access/retention remain private. Select real monitoring/alert recipients and thresholds for readiness/latency, 5xx, restart loops, DB connections/locks, packet/memory/storage/inodes, certificate expiry, backup age/failure and restore-test age. Demonstrate delivered and acknowledged alerts on isolated failures; these external monitoring checks are **NOT RUN**.

## 8. Storage, backup, retention and rollback

Uploads are private MySQL BLOBs with metadata/hash validation. There is no public upload directory or object-storage switch. Backups must include all application tables, migration ledger/lock, sequences and attachment bytes, plus separately protected profile/asset/definer/account dependencies. Keep DB data volumes outside release directories. Never point a static Nginx location at a DB, profile, backup, original upload or private archive.

Owner must choose RPO/RTO, backup schedule/retention, storage capacity, encryption-key custody, an off-server destination and restore responsibility. Off-server transfer/provider access is not authorized by this guide alone. See the operator guide for future consistent-capture/restore commands and blockers. Do not consider a successful dump sufficient: independently verify artifact provenance, restore with the source unavailable into a different empty target, reconcile schema/ledger/rows/BLOBs/quotation values/accounts/grants, start an isolated compatible app, test persistence/reconnect and measure recovery time/loss. Original backups remain immutable. The old v1-only frontend backup rehearsal does not cover the native v1–v3 target.

Maintain current/prior immutable release directories and their schema requirements. Before a future switch, stop new writes through an approved maintenance gate, drain only the two owned services, verify backup and record artifact/schema identity. Move traffic/current symlink only after separate cutover authorization; never overwrite an existing release directory. If the candidate fails, keep writes stopped, preserve all post-backup records and inspect compatibility before switching the app back. An older release that rejects the new ledger must remain stopped. No blind down migration, DB snapshot overwrite, checksum edit or automatic retry of an uncertain commit is a rollback. DB recovery is a separately approved new-target operation with reconciliation.

## 9. Staging, cutover and post-deployment smoke

Use a separately approved empty nonproduction MySQL target and synthetic identities, not copied demo/production accounts. The native harness now includes new product/deal/notes/stage/percentage quotation cases, but its real MySQL execution is **NOT RUN**. Follow the [acceptance matrix](staging-acceptance.md): login/logout/expiry, CSRF/permissions/reassignment revocation, deals/products, percentage discounts and historical preservation, both PDFs, all departments/jobs/reports/exports, upload bounds/protected files, concurrency/rollback/uncertain commit/restart and independent restore. Keep existing owner-reported local picker acceptance separate from automated staging.

Before cutover: independently sign off target/schema/grants, exact release/asset/license manifest, private configuration/issuer, TLS/host/network policy, all workflow/security evidence, backup/restore/RPO/RTO, alert delivery, maintenance/rollback authority and user access handoff. **No default administrator or password is created by startup/migration.** Initial production accounts/grants and any data import require a separate explicit owner-approved procedure; do not lift the existing demo identity into production.

After an independently authorized manual deployment, safe anonymous smoke commands against the owner-approved target (future only):

```bash
curl --fail --silent --show-error http://127.0.0.1:3002/api/v1/health/live
curl --fail --silent --show-error http://127.0.0.1:3002/api/v1/health/ready
curl --fail --silent --show-error https://OWNER_APPROVED_DNS_HOST/api/health/live
# Print status only; expected 401 without a session:
curl --silent --output /dev/null --write-out '%{http_code}\n' https://OWNER_APPROVED_DNS_HOST/api/auth/me
```

Then owner-operated normal login/workflows with authorized credentials, no credential collection in automation; verify Secure/HttpOnly/SameSite flags without displaying values, PDF/download/permission checks, logs/readiness and alerts. The existing bounded `verify-staging-http.ts` is specifically nonproduction-only; do not label a production target nonproduction to use it.

## 10. Troubleshooting and remaining approvals

- Configuration refusal: verify exact keys, canonical origin, physical profile path/UID/modes/format and explicit selector; do not print JSON or bypass checks.
- DB readiness/startup refusal: approved operator checks actual 8.4.11 identity/UUID/port, least privileges and exact migrations. Do not auto-migrate or reconnect to another DB.
- Login failure: inspect authorization/expiry/origin/secure-cookie behavior without resetting users/grants or capturing cookies. Reverse proxy must not rewrite Origin; public frontend and backend `APP_ORIGIN` must agree.
- Upload/PDF failure: check approved size/content policy, BLOB/packet capacity, issuer and exact assets; unsupported/active PDFs stay rejected. Do not expose files publicly to diagnose access.
- Migration interrupted: retain receipts/partial target and writes freeze; MySQL DDL may already be committed. Escalate to approved recovery, never rerun blindly.
- Missing assets or licenses, initial production identity provisioning, real isolated MySQL/Ubuntu/TLS/recovery/monitoring evidence and credential-incident remediation remain genuine release gates. No local test result substitutes for them.

GitHub publication is separate: revoke/rotate the exposed Zoho secret through authorized provider action, review affected tokens/grants/consumers, then independently verify a fresh positive-allowlist export with no old Git objects/uploads/private artifacts. No Git history, commit, push or deployment is authorized or performed by this document.
