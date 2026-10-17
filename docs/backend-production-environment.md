> Current layout: Next.js is at the repository root; Express is in `server/`. Use the root README for install/build/start commands. The preparation checkpoints below are not production acceptance.

# Backend production environment configuration

Owner-selected origin: **https://bills.voltronix.ae**, without a trailing slash. Selection is not DNS/TLS/reachability verification; the domain was not contacted. This is a source/configuration change, not deployment, migration or credential provisioning. Existing real environments and the running SQLite demo stay unchanged.

**Current checkpoint (2026-10-15):** the owner completed production OAuth setup. The saved grant now passes organization-read and CurrentUser-read probes; no additional consent is currently requested. The assistant did not replace the token or edit `.env`. Independent org/user/account-owner pinning and runtime activation remain incomplete. New session/readers, stage mappings, pure quotation codec and reconciliation review are code-injected preparation only; there are no new supported `.env` selectors for them. Keep `ZOHO_ENABLED=false`. See the [consolidated results and remaining gates](crm-readiness-report.md#consolidated-local-integration-batch).

## Where settings belong

- Supplied Ubuntu systemd units: `/etc/voltronix-crm/backend.env` and `/etc/voltronix-crm/frontend.env`, root-owned 0600, private directory. systemd supplies process settings; no duplicate package `.env` is necessary. Provision only in a separately approved staging/deployment phase.
- Independent backend CLI: `<release>/server/.env`, anchored at the backend executable regardless of working directory. Credential-bearing files require current-process ownership and private access (POSIX no group/other bits; Windows restricted current-owner/SYSTEM ACL). The loader only checks permissions; it never changes them. No root/project or old `nextjs` fallback.
- Frontend needs only its three server-side bridge settings. Never provide DB/Zoho credentials to frontend or `NEXT_PUBLIC_*`.

All npm commands run from the project root, with one root dependency installation and lockfile. Root `npm run dev` and `npm start` intentionally run the database-free local foundation; they do not load `server/.env` or activate configured MySQL. They are not production service entrypoints. After separate target approval and acceptance, root `npm run start:api:configured` invokes the real compiled API at `server/dist/cli.js`; the supplied systemd units start API and Next independently with their separate environments. The root README remains authoritative for local run commands and current limitations.

## Production backend template — inactive, owner fills private values

```dotenv
CRM_API_ENVIRONMENT=production
CRM_API_HOST=127.0.0.1
CRM_API_PORT=3002
APP_ORIGIN=https://bills.voltronix.ae
CRM_RUNTIME_ENABLE=approved-production-mysql-crm-runtime
CRM_RUNTIME_SOURCE=environment
CRM_RUNTIME_PROFILE=
CRM_MYSQL_NETWORK_DISABLED=1
CRM_MYSQL_HOST=127.0.0.1
CRM_MYSQL_PORT=3306
CRM_MYSQL_DATABASE=<actual-approved-schema>
CRM_MYSQL_USER=<actual-approved-runtime-user>
CRM_MYSQL_PASSWORD='<private-runtime-password>'
CRM_MYSQL_SERVER_UUID=<actual-verified-server-uuid>
CRM_MYSQL_APPROVED=true
CRM_MYSQL_APPROVAL_REFERENCE='<actual-owner-approval-reference>'
CRM_MYSQL_PROVISIONING_REFERENCE='<actual-provisioning-reference>'
CRM_MYSQL_ISSUER_COMPANY='<actual-approved-supported-company>'
CRM_MYSQL_ISSUER_SALESPERSON='<actual-approved-display-name>'
ZOHO_ENABLED=false
ZOHO_CLIENT_ID=
ZOHO_CLIENT_SECRET=
ZOHO_REFRESH_TOKEN=
```

Placeholders deliberately do not constitute valid target configuration. Do not copy old compromised credentials. `CRM_MYSQL_APPROVED=true` records an actual approval, not permission manufactured by setting a boolean. Obtain real schema/user/UUID/provisioning information from the authorized DB operator. Runtime user must have only the existing exact table grants, never root/migration authority. Supported company is the owner's actual choice of `VOLTRONIX CONTRACTING LLC` or `VOLTRONIX SWITCHGEAR LLC`; salesperson is an approved printable display name.

Keep `CRM_MYSQL_NETWORK_DISABLED=1` for offline preparation/checking. Only a separately authorized real-target process may leave it blank. The veto is unchanged; selecting environment mode does not bypass it. The target remains co-located Oracle MySQL 8.4.11 at loopback 3306 or 3308; remote DB support is not introduced.

Every `CRM_MYSQL_*` field above except the network veto is required in environment mode. Missing/invalid fields fail closed. The same v2 runtime validator enforces target/user/schema/issuer/approval constraints, and real startup still checks UUID, privileges and exact migrations before listening. No profile fallback, schema migration, account creation or data import occurs. `CRM_RUNTIME_PROFILE` must be empty; choosing both sources is an error. Existing JSON-profile users remain supported with `CRM_RUNTIME_SOURCE` and the new credential fields absent/blank. Existing local/test profiles and demo guards are unchanged; environment credential mode is production-only.

Single-line dotenv values only; quote spaces and `#`, no interpolation or multiline values. The backend file is limited to 16,384 bytes. Explicit process values override package dotenv settings, including explicit empty values. Do not combine stale process credentials with a newly edited file; use one reviewed source. Systemd environment-file quoting must also be reviewed by the server operator; do not rely on shell expansion. Process environment secrets can be visible to the same UID/root and privileged diagnostic tools: retain separate service UIDs, restricted access and no environment/process dumps, debugger or secret-bearing logs.

## Frontend production template

```dotenv
CRM_FRONTEND_BACKEND=express
CRM_EXPRESS_ORIGIN=http://127.0.0.1:3002
APP_ORIGIN=https://bills.voltronix.ae
```

No trailing slash and no `/api/v1` on `CRM_EXPRESS_ORIGIN`. `NODE_ENV=production` is already in the systemd units; it is not an additional supported backend dotenv key. Do not change the active local demo to these production values.

## Zoho limitation — configuration only, not live sync

`ZOHO_ENABLED` must be absent or `false`. The API runtime recognizes bounded single-line `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`, `ZOHO_REFRESH_TOKEN` for inactive configuration only; it has no automatic token refresh, scheduler or synchronization. Unknown Zoho keys and enabling `true` refuse startup instead of falsely advertising integration. Never copy the exposed historical secret. Field mappings, sync direction, idempotency and runtime token lifecycle still need an implemented and accepted integration.

### Manual PMCRM credential setup and check

The separate local helper supports the owner's confirmed **US PMCRM** client only: Accounts at `https://accounts.zoho.com`, CRM API at `https://www.zohoapis.com`, and the registered redirect `https://crm.voltronix.ae/crm/pm/index.php/zoho/callback`. It does not enable runtime integration or connect to MySQL. Store the current client ID and secret privately in `server/.env` first; the existing private-file ownership/permissions checks still apply.

Run from the repository root in your local interactive terminal:

```powershell
npm run zoho:setup
```

Open the fresh authorization link printed by that run and approve the intended **Production** organization. The requested scopes are `ZohoCRM.modules.ALL,ZohoCRM.settings.fields.READ,ZohoSearch.securesearch.READ,ZohoCRM.org.READ,ZohoCRM.users.READ` (full CRM module access, field metadata, search, organization-read and user-read). The last two scopes were added for future explicit organization/user verification; refreshing an older grant does not add them. This optional interactive command replaces the saved refresh token after successful exchange, so do not rerun it simply to perform the ordinary read-only check. Copy the complete browser address after redirect, even if the callback page shows 404, and paste it into the waiting terminal promptly. Input is hidden. Do not paste the URL into chat or put it in shell arguments/history. The one-time code must come from this run's link and is short-lived.

The helper extracts the code without opening the callback URL, exchanges it with Zoho, and replaces only `ZOHO_REFRESH_TOKEN` in the existing private file. It preserves other settings and file permissions and refuses to overwrite a file changed while waiting for consent. A browser `code` is not a refresh token. After saving, it performs a read-only Deals field-metadata check; no CRM records are created or changed. If that read fails, the saved token is retained for retry.

To verify the saved refresh token and read-only API access later:

```powershell
npm run zoho:check
```

These commands send credentials only to the fixed HTTPS Zoho endpoints, print no tokens/secrets, skip MySQL, and leave `ZOHO_ENABLED` unchanged. A successful check proves credential acceptance and that metadata read only, not end-to-end synchronization or production readiness.

### Read-only field inspection without Sandbox

The owner has deferred Sandbox. To inspect the existing grant without new consent or changing `.env`:

```powershell
npm run zoho:inspect
```

This source-checkout helper refreshes the saved US grant, probes `/crm/v8/org`, then reads only Accounts/Contacts/Deals/Products/Quotes field metadata. It never requests business records, performs a business mutation, selects a dynamic endpoint, connects to MySQL, saves tokens or changes runtime settings. Networking is explicitly enabled only by invoking this command; `ZOHO_NETWORK_DISABLED=1`, debugger settings and extra arguments refuse before private file loading. Help is offline.

Reports contain only fixed diagnostic codes, known source-field names and aggregate counts. Missing organization-read scope leaves identity **NOT_VERIFIED** while the fixed field-only inspection can continue. Even an observed production organization is not an owner-pinned target identity; `targetOrganizationVerified` remains false. A valid report exits **2** (inspection only), a failed command exits **1**, help exits **0**. Do not interpret exit 2 or observed fields as permission/schema/financial/workflow acceptance. `ZOHO_ENABLED` stays false, and the runtime client's identity/write guards are unchanged.

The first read-only inspection found all five module metadata responses, but expected `Accounts.Email`, `Deals.Department` and `Quotes.Amount` were not observed. `Deals.P_Box` had a case-mismatch finding; expected stage/status values differed. These need explicit field/business mapping review, not automatic field creation, guessed replacement names or schema mutation. See the [current readiness evidence](crm-readiness-report.md#without-sandbox-progress).

The follow-up inspector additionally checks fixed retained-source candidates `Deals.Assign_Department1` and `Deals.P_BOX` using the same five responses, and lists only **source-expected** missing picklist values. Both candidates were observed with expected type/create flags. The opt-in `legacy-conversion-fields-v1` deal payload profile supports those two names without dropping Account.Email; it is not selected by runtime defaults or a new `.env` key. A separate bounded metadata probe established that `Stage` API value `Needs Analysis` displays **Site Visit**, while app-status values include `Proposal`, `Close to Won`, `Close to Lost`. The explicit `voltronix-stage-labels-v1` candidate supports these distinctions; required Pipeline/layout membership still needs review. The default inspector intentionally retains original-contract findings rather than automatically substituting profiles. Quotation child metadata and currency/percentage distinctions were also observed in that separate probe, but formulas/rounding and real workflow acceptance remain unverified.

## Safe validation and remaining gates

With a privately prepared approved configuration, the existing `npm run config:check` validates settings without opening a listener/DB connection. It reports source and status, not passwords/tokens/database names. A PASS is configuration-only, not an approval/target/workflow acceptance. This phase uses synthetic test configuration; no real credential file is created.

Native migrations still use the separate protected operator JSON/profile and authority; this change does not put migration credentials into the API environment. The [manual guide](manual-deployment-guide.md) JSON runtime option remains an alternative. This environment option supersedes earlier statements that MySQL can only use JSON or no Zoho configuration keys are recognized; automatic Zoho synchronization still remains unimplemented. New source/templates invalidate earlier publication/package fingerprints: do not deploy an old candidate expecting these keys. Rebuild/review a new candidate only in the next approved release-preparation phase.
