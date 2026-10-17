**HUB production operations**

This guide describes the reviewed HUB configuration and operating procedure. Production acceptance requires recorded HTTPS, authenticated business, restart-persistence, recovery and timer checks. A running process or a successful build alone does not establish completion.

| Component | Reviewed target |
| --- | --- |
| Public application | `https://hub.voltronix.ae` |
| HTTPS reverse proxy | `192.168.30.20`, forwarding HUB traffic to `192.168.30.21:3090` |
| Next.js frontend | `192.168.30.21:3090`, PM2 name `voltronix-hub` |
| Express API | `127.0.0.1:3002`, PM2 name `hub-api`, instance ID `hub-crm` |
| Database | MySQL **8.4.11**, `127.0.0.1:3306`, dedicated schema `voltronix_hub` |
| Runtime | Node.js **24.x**, canonical executable `/usr/bin/node` |
| PM2 | `/usr/lib/node_modules/pm2/bin/pm2`, user `rjpmadmin`, `PM2_HOME=/home/rjpmadmin/.pm2` |
| Source checkout | `/home/rjpmadmin/voltronix-hub-deployment/source`, reviewed GitHub `main` |
| Release root | `/var/www/hub.voltronix_ae/releases/`, with `/var/www/hub.voltronix_ae/current` identifying the accepted release |

Keep MySQL and the API on loopback. Restrict frontend TCP 3090 to the approved reverse proxy and necessary local administration. Browser requests use the public `/api/...` bridge; the bridge verifies the API identity and forwards authentication and CSRF state. The protocol service identifier remains `bills-crm-api`; the matching `hub-crm` instance ID and HUB origin distinguish this deployment.

Configuration stays outside Git, checkouts and releases in `/home/rjpmadmin/hub-config/frontend.env` and `backend.env`. Use owner-only backend permissions and protected, ordinary parent directories; do not place active `.env` files in a release. The backend file is the sole runtime database-credential source. PM2 stores the launcher path and external filename, while the launcher reads and passes each role's explicit configuration to its child. Both PM2 applications run as `rjpmadmin`; environment separation does not provide separate Unix file-access identities.

The production runtime requires explicit approval, server identity, current native migrations and exact table grants. The application account is `hub_app@127.0.0.1`. The separate `hub_migrate@127.0.0.1` migration account is locked after the three reviewed migrations, which produce 33 tables including the migration ledger. Unlocking an operator identity or changing schema requires a separate reviewed operation. Startup, health checks and automatic deployment do not migrate, seed or repair a database. Do not substitute another MySQL patch release or MariaDB: the current native guard requires exactly 8.4.11.

The selected issuing company is **VOLTRONIX CONTRACTING LLC**. Retain the privately configured, operator-approved salesperson display name; this guide contains no personal account details. Issuer fields are required by production configuration and are snapshotted when a local quotation is created. Issuer configuration does not supply the separately excluded company PDF backgrounds, signature or stamp. Keep Zoho synchronization disabled; credentials do not activate an implemented synchronization workflow.

Initial administrator onboarding is an explicit operation against an empty `users` table. From the trusted release, invoke:

```sh
/usr/bin/node server/dist/operations/bootstrap-admin-cli.js \
  --env-file /home/rjpmadmin/hub-config/backend.env \
  --identity-file /absolute/private/onboarding.json
```

The separate owner-protected identity file must contain explicit `version: 1`, `name`, `email` and a strong private `password`, encoded as compact or two-space JSON. Keep it outside the release; never pass a password on a command line, publish it or log its contents. There is no default account or default password. The CLI validates the dedicated HUB target, hashes with bcrypt cost 12 and creates nine explicit business/settings grants and audit records atomically. It refuses any nonempty user table and provides no reset or overwrite path. Preserve the private identity file if the outcome is uncertain and inspect state before another invocation.

Run direct API probes on the application host without query strings:

```sh
curl -fsS http://127.0.0.1:3002/api/v1/health/live
curl -fsS http://127.0.0.1:3002/api/v1/health/identity
curl -fsS http://127.0.0.1:3002/api/v1/health/ready
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3002/api/v1/auth/me
```

Liveness, matching identity and readiness must return 200; readiness must contain `status: ready`. Anonymous `auth/me` must return 401. Check the public HTTPS login page, public API identity/readiness, anonymous denial and release assets independently. `hub:check:api` checks configuration, build output and a free listener before startup; actual API startup performs MySQL readiness. A listener already owned by the running application is not a reason to stop an unrelated process merely to run preflight.

Authenticated persistence acceptance uses an explicitly labelled internal quotation **line item**: create and read the target, update its quantity, record the full saved quotation, restart both HUB processes and verify identical readback through a fresh authenticated session. Retain private evidence of the actual API and web PIDs changing. Remove the target through the existing quotation PATCH operation, then read its absence and the remaining control-line total. This establishes quotation-line CRUD only. Top-level product, deal and quotation deletion is unsupported; labelled parent records and the control line remain for audit. No real customer, order or sale is represented by these fixtures.

For an approved scoped restart, use a clean PM2 invocation and preserve its existing definitions:

```sh
hub_pm2() {
  env -i HOME=/home/rjpmadmin USER=rjpmadmin LOGNAME=rjpmadmin \
    PM2_HOME=/home/rjpmadmin/.pm2 PATH=/usr/bin:/usr/local/bin:/bin \
    /usr/bin/node /usr/lib/node_modules/pm2/bin/pm2 "$@"
}
hub_pm2 restart hub-api
# Confirm API identity and readiness before restarting the frontend.
hub_pm2 restart voltronix-hub
```

Never restart, delete or reload all PM2 applications. Preserve the accepted process definitions, PM2 dump backup and previous release. A failed candidate activation triggers the controller's scoped restoration of the previous HUB definitions and release pointer. It does not restore a database backup over ongoing writes. If rollback or ownership validation fails, retain `blocked.json`, receipts and logs for investigation; do not clear the block to force another deployment.

Install the reviewed controller outside the fetch checkout and releases at `/home/rjpmadmin/hub-deploy/hub-deploy.sh`. Install `hub-deploy-user.service` as `~/.config/systemd/user/hub-deploy.service`, alongside `hub-deploy.timer`. The user unit uses the canonical Node and PM2 paths above and the source checkout ending in `/source`. Review its sandbox support and user-manager reboot persistence on the actual host. The separate system-manager example is an alternative, not a second scheduler to enable simultaneously.

Before scheduling, require a genuinely accepted first release, healthy public and direct checks, authenticated persistence/PID evidence, a reviewed PM2 startup arrangement, a backed-up PM2 dump and the protected `/home/rjpmadmin/hub-deploy-state/accepted.json`. The receipt binds the release, commit lineage, launcher/ecosystem bytes, executable paths and configuration-file identity. Do not fabricate it to bypass an unsuccessful check. Configuration changes require deliberate revalidation of accepted state.

After a successful manual service run, the user timer checks `main` every two minutes:

```sh
systemctl --user daemon-reload
systemctl --user start hub-deploy.service
# Inspect successful completion and the accepted receipt before enabling.
systemctl --user enable --now hub-deploy.timer
systemctl --user list-timers hub-deploy.timer
journalctl --user -u hub-deploy.service --since today
```

The controller locks concurrent runs, verifies accepted ownership and ancestry, archives the exact fetched commit, builds and runs the explicit public-source gates before replacing HUB processes. Private historical suites are not claimed to pass. It accepts a candidate only after database readiness, direct/public website and asset checks, anonymous denial and PM2 definition validation; failed candidates and the previous healthy release remain available. Use a later reviewed documentation-only `main` commit to verify an actual scheduled commit transition after initial acceptance. Record the accepted before/after commits and service journal; installing the timer alone is insufficient evidence.

Keep `/home/rjpmadmin/hub-deploy-logs` and deployment state private. HUB logs are `deploy.log`, `hub-api.out.log`, `hub-api.error.log`, `voltronix-hub.out.log` and `voltronix-hub.error.log` in that directory. Review/install user log rotation after acceptance using only `/home/rjpmadmin/hub-deploy/hub-logrotate.conf` and private state `/home/rjpmadmin/hub-deploy-state/logrotate.status`. The reviewed configuration covers those five exact files, with daily rotation, a `20M` size threshold, 14 retained rotations and delayed compression; it must not target other PM2 applications or a wildcard PM2 log directory. Validate the prepared user schedule and permissions before enabling it. Redact private diagnostics before sharing; never publish environment files, identity files, cookies, PM2 environment dumps or credential contents.
