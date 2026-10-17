# Bills CRM release checklist

**2026-10-17: local deployment preparation only. Production data activation and public cutover remain blocked.** The intended hostname is `bills.voltronix.ae`; the existing `crm.voltronix.ae` service, legacy PHP source, database, uploads and backups must continue unchanged. No command in the [manual runbook](manual-deployment-guide.md) has been executed against the server by this task.

This checklist supersedes the old native-schema installation assumptions for this target. Use the [current verification report](production-preparation-report.md) for actual local test counts; historical suite totals, source builds, static template tests and HTTP liveness are not production acceptance.

| Gate | Current scope / evidence required |
| --- | --- |
| Single-root build | One root `package-lock.json`; contracts, API and Next build together. Reproduce on the chosen Linux architecture with app-local Node 24.x. |
| Isolated services and ports | New `bills-crm-web` and `bills-crm-api` users/services; loopback ports 3301/3302 are examples requiring read-only host verification. Never reuse occupied 3001/3002. |
| Environment and API identity | Separate environment templates, explicit canonical HTTPS origin, matching Bills API identity, disabled database/network/Zoho. Invalid configuration must refuse startup. |
| Database-free foundation | Liveness and login UI can run. Readiness and authentication remain unavailable. No demo data, SQLite fallback or database initialization is acceptable. |
| Legacy database adapter | **BLOCKED: not implemented.** Obtain authoritative redacted DDL, constraints/indexes/triggers/views, schema version and table engines; reconcile each contract with repository evidence. Native migrations are incompatible with the unverified legacy target. |
| Historical users and authorization | **BLOCKED:** prove password hashing/verification, account state, role/department/employee permissions, session expiry/revocation and all ownership rules on synthetic fixtures and an approved isolated copy. Never weaken authorization or create default users. |
| Historical CRM relationships | **BLOCKED:** verify leads/deals/pipeline/history, item identifiers and units, quotation lines/taxes/currencies/rounding, jobs and department relationships. Preserve percentage-only discount behavior and historical totals. |
| Attachments and PDF resources | **BLOCKED for affected features:** derive ownership/path mappings and approved asset provenance; original signatures, stamps/backgrounds and historical attachments are intentionally excluded. No unrestricted upload-folder copy or public alias. |
| Concurrent legacy/new writes | **BLOCKED:** map transactions, locking, idempotency, audit history and conflict semantics. A read-only projection is not permission for writes. |
| Zoho | **BLOCKED / disabled:** runtime synchronization and accepted identity, field mapping, token lifecycle, direction and reconciliation are unfinished. Keep `ZOHO_ENABLED=false`. |
| Host / TLS / Nginx | **NOT RUN:** verify OS/systemd/Nginx versions, resources, unused directories/users/ports, DNS and certificate validity/renewal. Run `nginx -t` before any separately approved reload. |
| Preservation and backup | **NOT RUN ON HOST:** verify owner-managed recoverable backups and baseline checksums/permissions for existing files; record existing service state. Do not perform database writes or use a file-copy backup of a live database as recovery proof. |
| Local tests | Run typecheck, lint, applicable unit/integration/auth/contract/config/port-conflict tests and production build. Identify excluded private fixtures separately; do not silently treat skipped suites as passed. |
| Dependency findings | Report actual installed/pinned dependency findings separately. No forced audit fix or unrelated upgrade; dependency and native-module behavior still need Linux verification. |
| Package boundary | New allowlisted source candidate; complete source/configuration/approved assets and startup tools. Verify all hashes and content. Exclude secrets, real environments, databases, uploads, sessions, private assets, `.git`, dependencies and generated builds. |
| Recovery / rollback | Rehearse only on an approved isolated host. Roll back Bills service/symlink/Nginx changes only; preserve old releases and new failures. No database restore or legacy restart belongs to this procedure. |
| Publication and deployment | **Not performed.** Review exact diff/artifact and separately approve commit/push and any future deployment. |

Before enabling real users, acceptance must exercise login/logout/session revocation, anonymous denial and permission boundaries, dashboard/navigation, every CRM workflow above, protected downloads and cross-owner denials, errors/audit redaction, PDF correctness, backups and concurrency. Offline mock tests cannot replace isolated real-schema acceptance.

A future foundation smoke test must observe expected HTTP 503 readiness/authentication and must not be described as a working CRM. If acceptance requires real history, keep public traffic unchanged until the legacy adapter, file ownership and recovery gates are closed.
