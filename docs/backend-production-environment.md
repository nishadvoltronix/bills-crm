# Bills CRM environment contract

This is the database-disabled production-mode foundation for `https://bills.voltronix.ae`. It permits isolated startup checks, not access to the existing CRM database. No host, DNS, certificate, MySQL server or Zoho service was contacted to prepare these templates.

Use one root dependency installation, Node **24.x**, separate web/API processes and separate environment files. The reviewed entrypoint is `node tools/run-bills.mjs web|api|check-web|check-api|build`. The older development launcher and native-schema operator tooling are not deployment entrypoints for the legacy CRM.

## Separate templates

Copy only reviewed nonsecret values from `deploy/ubuntu/bills-web.env.example` and `deploy/ubuntu/bills-api.env.example` into future root-owned mode-0600 `/etc/bills-crm/frontend.env` and `/etc/bills-crm/backend.env`. The systemd manager reads these files and gives each service only its own environment. No file has been created on a server. Do not copy any existing root or `server/.env`, private profile, secret or database configuration into a release. The Bills wrapper refuses nonexample dotenv files in the release root and `server/` so Next.js cannot silently load an inherited local configuration.

| Setting | Web | API | Exact safe value / requirement |
| --- | --- | --- | --- |
| `NODE_ENV` | Required | Required | `production` |
| `APP_ORIGIN` | Required | Required | `https://bills.voltronix.ae`, no path, credentials or trailing slash |
| `CRM_DATABASE_MODE` | Required | Required | `disabled`; no supported legacy activation selector |
| `CRM_MYSQL_NETWORK_DISABLED` | Required | Required | `1` |
| `ZOHO_ENABLED` | Required | Required | `false` |
| `CRM_API_INSTANCE_ID` | Required | Required | `bills-crm`; must match across the two processes |
| `CRM_FRONTEND_BACKEND` | Required | Omit | `express`; no direct Next database fallback |
| `CRM_EXPRESS_ORIGIN` | Required | Omit | `http://127.0.0.1:3302`; explicit Bills-only API address, no `/api/v1` suffix |
| `CRM_WEB_HOST` | Required | Omit | `127.0.0.1`; only loopback bindings are allowed |
| `CRM_WEB_PORT` | Required | Omit | `3301` as an example, confirmed unused before use |
| `CRM_API_ENVIRONMENT` | Omit | Required | `production` |
| `CRM_API_HOST` | Omit | Required | `127.0.0.1`; only loopback bindings are allowed |
| `CRM_API_PORT` | Omit | Required | `3302` as an example, confirmed unused before use |
| `NEXT_TELEMETRY_DISABLED` | Required | Required | `1` in both reviewed profiles |

Ports **3001 and 3002 are already occupied on the intended server**. The examples use **3301 and 3302**, whose availability is still unverified. Changing ports requires coordinated updates to the web/API environment and Nginx upstream. The API origin must be the explicitly selected Bills API; a loopback address alone does not establish which application owns a port. Startup checks reject occupied listeners without stopping their owners. A reservation check has a race window; a bind-time conflict must also stop startup and be investigated, never resolved by killing an unrelated process.

The web bridge validates `/api/v1/health/identity` against the configured instance ID and canonical app origin before forwarding credentials or requests. This is a protection against accidental misrouting, not cryptographic peer authentication or readiness. It must not be used to justify trusting a hostile local service. Keep separate service identities, loopback listeners and protected configurations.

## Safe validation and expected behavior

The supplied systemd units run the appropriate `check-api` or `check-web` preflight with their separate service environment. For a future standalone operator check from a built release root, load only the reviewed example into a clean subshell (these commands contain no secrets):

```bash
env -i PATH=/var/www/bills.voltronix_ae/runtime/node/bin:/usr/bin:/bin /bin/sh -c '
set -eu
set -a
. ./deploy/ubuntu/bills-api.env.example
exec node tools/run-bills.mjs check-api
'
env -i PATH=/var/www/bills.voltronix_ae/runtime/node/bin:/usr/bin:/bin /bin/sh -c '
set -eu
set -a
. ./deploy/ubuntu/bills-web.env.example
exec node tools/run-bills.mjs check-web
'
```

These validate configuration, build files and port availability without connecting to a database or creating data. `check-web` and `web` have different purposes: starting `web` also verifies the configured API identity. Start the Bills API first. `build` validates the web environment and compiles contracts, Express and Next; it does not require a running API.

Missing or malformed production settings, implicit ports, nonloopback origins, forbidden database/runtime selectors and credential-bearing configuration fail closed. Do not add `CRM_RUNTIME_ENABLE`, `CRM_RUNTIME_PROFILE`, `CRM_RUNTIME_SOURCE`, any MySQL connection/credential fields, `DATABASE_URL`, Zoho tokens or public `NEXT_PUBLIC_*` credentials. `CRM_MYSQL_NETWORK_DISABLED=1` is a safety veto, not database compatibility. Removing it does not implement or approve a legacy adapter.

| Probe / operation | Expected in this mode |
| --- | --- |
| API `/api/v1/health/live` | HTTP 200; process liveness only |
| API `/api/v1/health/identity` | HTTP 200; configured Bills instance/origin |
| API `/api/v1/health/ready` | HTTP 503; persistence intentionally unavailable |
| Web `/api/health/live`, `/login` | Liveness / login UI available |
| Login, sessions and authenticated CRM data | Unavailable; no default user or demo fallback |
| Zoho synchronization | Disabled; no background token refresh or synchronization |

The application uses database-backed session/CSRF state. There is no new default account, shared JWT secret or production development-auth bypass. Existing percentage-only quotation discounts remain unchanged; this phase does not recalculate historical quotations.

## Database activation remains blocked

The native-schema MySQL adapter is not an adapter for the ten-year PHP CRM. Source-level table references and partial projections do not prove the full schema, password hashing, roles, permissions, session behavior, ownership or concurrent-write semantics. A legacy adapter has not been implemented and accepted. Never run native migrations or seeds against the existing database. See the [legacy compatibility evidence](legacy-production-compatibility.md) and [release checklist](final-release-checklist.md) for the exact evidence required before a separate adapter/activation change.

Historical native-profile and Zoho setup instructions are not part of this deployment workflow. No OAuth exchange, metadata probe, migration, user provisioning, import or database inspection command is required for this foundation.
