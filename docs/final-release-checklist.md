# Final release checklist

Current phase: safe local implementation and manual Ubuntu 24.04 package preparation. **Production cutover and GitHub publication remain BLOCKED.** Detailed local evidence remains in the separately retained repository readiness report. Use [manual deployment](manual-deployment-guide.md), [MySQL operator instructions](mysql-production-operator-guide.md) and [staging acceptance](staging-acceptance.md). This checklist does not authorize any server action.

**2026-10-15 update:** the owner intends concurrent `crm.voltronix.ae` and `bills.voltronix.ae` use on the existing legacy database. The legacy runtime adapter is not implemented; never apply native migrations to that live schema. Production OAuth setup is complete and org/current-user reads succeed, but independent identity pinning, live workflow acceptance and runtime synchronization remain unfinished. The [consolidated batch checkpoint](crm-readiness-report.md#consolidated-local-integration-batch) supersedes the historical test counts below. Newly added injectable readers/stage/quote/reconciliation components are not production activation. Earlier package fingerprints do not cover these source changes; an old runtime export must not be presented as the new build.

| Gate | Status / evidence required |
| --- | --- |
| HTTPS-aware Next/Express configuration/cookies, issuer delivery, native MySQL operator and readiness | Local implementation completed; full offline suites passed. Actual HTTPS/MySQL acceptance remains separate. |
| Backend tests / SQLite tests | **VERIFIED PASS:** 549/549 backend; 142/142 SQLite. |
| Backend and demo types, backend lint/build, migration/package boundaries | **VERIFIED PASS**, exact commands in readiness. |
| Frontend full tests/types/lint/build, anonymous browser and picker | **PASS:** 463/463 full tests including intercepted-browser picker regression; types/lint and isolated webpack production build; 63/63 anonymous checks on unchanged live demo. Authenticated picker acceptance remains owner-reported, not new automation. |
| Database/protected files | **PASS:** fresh 37 tables/419 rows, integrity OK/FK0; 503 uploads, 5,979 private artifacts, 2,631 original source files/3 PHP modifications match retained checks. **BLOCKED evidence:** phase-wide exact row/hash comparison unavailable because the in-memory monitor's stdin closed; no restoration/baseline change. |
| Separate source-runtime candidate and exact content verification | Exporter/tests implemented; exact final artifact path/count/result recorded separately in repository readiness, not self-certified here. No original data/assets deleted. |
| Asset/issuer/license approval | **OWNER TO CONFIRM:** approved company/salesperson; exact theme/font/branding/PDF assets and rights. Candidate excludes all assets pending this gate. |
| Production MySQL target, migrations, CRUD/concurrency/recovery | **BLOCKED / NOT RUN:** no approved running isolated target/private profiles; offline tests are not MySQL acceptance. |
| Ubuntu/Nginx/systemd/TLS/firewall/resources/certificate renewal | **OWNER TO CONFIRM / NOT RUN:** templates are future commands, not installed or host-verified. |
| Initial production accounts/grants/data | **OWNER TO CONFIRM:** no default user/credential or import. Preserve demo and historical values; separate provisioning authority/procedure required. |
| Backup/restore/rollback, RPO/RTO, monitoring/alerts | **BLOCKED / NOT RUN:** owner selects custody/retention/recipients; independently execute approved isolated recovery and failure exercises. |
| Historical attachments/unsupported PDFs | **BLOCKED only for affected import/unsupported scope:** all 503 owners unverified; 12 rejected PDFs stay safely rejected. No fabricated ownership/input. |
| GitHub publication | **BLOCKED:** authorized Zoho remediation, asset/license decisions, independently verified sanitized export and separate publication approval. |
| Deployment, restart of live services, credentials or existing DB changes | **NOT RUN / prohibited during this phase.** |

**Single safest next manual action:** perform the read-only Ubuntu/server/network preflight in the manual guide and record the actual target prerequisites privately. Do not install, migrate, expose ports, provision credentials or switch traffic until its blockers and isolated staging scope are explicitly resolved.
