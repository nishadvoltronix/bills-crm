# Manual Bills CRM deployment and rollback

**Future owner-operated instructions only. None of these server commands was run. No server, production database, DNS service or live website was contacted.** This is an isolated database-disabled foundation, not approval to publish a working CRM. Existing `crm.voltronix.ae`, PHP source, ten-year database, uploads, sessions and backups must remain unchanged. Database compatibility and production cutover remain blocked by the [release checklist](final-release-checklist.md).

The target layout uses one project directory and one dependency installation:

```text
/var/www/bills.voltronix_ae/          existing directory: preserve all contents
  runtime/node/                     NEW app-local, verified Node 24.x
  bills-releases/<release-id>/       NEW immutable release; never overlay
  bills-current -> bills-releases/<release-id>  NEW Bills-only symlink
/etc/bills-crm/frontend.env          NEW web configuration, root:root 0600
/etc/bills-crm/backend.env           NEW API configuration, root:root 0600
```

Nginx `bills.voltronix.ae` -> web `127.0.0.1:3301` -> API `127.0.0.1:3302`. Ports **3001/3002 are occupied**; **3301/3302 are examples, not verified available ports**. No API or database listener is exposed publicly. The web verifies the Bills API's explicit identity before forwarding credentials. Separate `bills-crm-web` and `bills-crm-api` accounts run the two services.

## 1. Read-only preflight and stop conditions

The operator first confirms the actual host, maintenance scope, backup custodian and available resources. These are future manual commands, not a request for this agent to connect:

```bash
cat /etc/os-release
uname -m
id
free -h
df -hT /var/www /var/backups
df -i /var/www
ss -ltnp
systemctl --type=service --state=running
systemctl --version
nginx -v
sudo nginx -t
sudo stat /var/www/bills.voltronix_ae
sudo find /var/www/bills.voltronix_ae -maxdepth 1 -printf '%M %u:%g %f\n'
getent passwd bills-crm-web bills-crm-api
getent group bills-crm-web bills-crm-api
systemctl list-unit-files 'bills-crm-*'
```

Record results privately. Confirm 3301 and 3302 have no listener and are reserved for Bills; do not terminate any owner of a conflicting port. Confirm that `runtime`, `bills-releases`, `bills-current`, `/etc/bills-crm`, both proposed users/groups/services and the new Bills Nginx filename are absent, including dangling symlinks. If any exists, stop and review its owner and purpose; never reuse or overwrite it blindly. If the target is a symlink, mounted application volume or a different directory than expected, obtain a reviewed layout first. The guide assumes an ordinary existing directory.

Inspect the existing Bills/CRM virtual hosts privately before choosing a separate filename. A second `server_name bills.voltronix.ae` is a conflict even when `nginx -t` exits zero with a warning. Existing `crm.voltronix.ae` configuration, global Nginx files, system-wide Node, firewall rules and other application processes are outside this change. Record baseline service state and approved existing health evidence; do not use business mutations as probes.

## 2. Backups and preservation evidence before changes

Have the existing backup owner verify the current CRM database backup and an isolated recovery receipt through their established procedure. This runbook issues **no database command**, opens no connection and supplies no dump/restore/migration command. A directory tarball is not proof of a consistent live database backup.

Create a private backup of the existing Bills directory before adding any child paths. Use an approved backup filesystem with adequate space, outside `/var/www/bills.voltronix_ae`. For example, after verifying this new destination is absent:

```bash
set -euo pipefail
release_id=bills-foundation-20261017-01   # choose a NEW recorded identifier
backup_dir=/var/backups/bills-crm-preparation/$release_id
test ! -e "$backup_dir"
test ! -L "$backup_dir"
sudo install -d -m 0700 "$backup_dir"
sudo tar --acls --xattrs --one-file-system -cpf "$backup_dir/bills-before.tar" \
  -C /var/www bills.voltronix_ae
sudo tar --compare --acls --xattrs -f "$backup_dir/bills-before.tar" -C /var/www
sudo sha256sum "$backup_dir/bills-before.tar"
```

Review warnings/exit codes; changing files or excluded submounts require the backup owner's consistent-copy procedure before continuing. Store the archive hash, file permissions, existing symlink targets and existing service/configuration baseline privately. Verify recoverability on an isolated location, never by restoring over live files. Do not include the backup or its contents in a release, Git commit or chat. Retain any failure evidence.

## 3. Prepare, verify and transfer a fresh source candidate

Run local checks from the separate preparation checkout; do not package the retained original workspace. The allowlisted exporter includes required source/configuration and selected approved assets, omits real environments, databases, uploads, sessions, private PDF marks, Git history, dependencies and build outputs. Read `bills-crm-source/FILE-MANIFEST.json` for exact exclusions. An old candidate does not cover new code changes. The exporter verifies the exact ZIP contents as well as the source directory; do not repackage its result or transfer its tests/source checkout instead.

Local PowerShell commands after reviewing the final diff and test report:

```powershell
$candidate = (node tools/prepare-bills-package.mjs --create | ConvertFrom-Json).output
if ($LASTEXITCODE -ne 0 -or -not $candidate) { throw 'Package creation failed' }
node tools/prepare-bills-package.mjs --verify $candidate
if ($LASTEXITCODE -ne 0) { throw 'Package verification failed' }
$archive = Join-Path $candidate 'bills-crm-source.zip'
tar -tf $archive
if ($LASTEXITCODE -ne 0) { throw 'Archive inspection failed' }
Get-FileHash -LiteralPath $archive -Algorithm SHA256
```

Review the archive list against the verified manifest and the checksum via an independently trusted channel. Transfer **only the archive and checksum** to an operator-created NEW private incoming directory; never copy the working tree, `.git`, node_modules, existing production env or retained private files. Replace the example SSH alias and incoming path only after explicit deployment approval:

```powershell
scp $archive "$archive.sha256" bills-approved-host:/approved/new-private-incoming/
```

That command is documented only and was not executed. The incoming directory must be owned by the approved build operator, mode 0700, outside public document roots. Record the actual archive basename and checksum.

## 4. App-local Node and Linux build

Provision a reviewed official Node **24.x** distribution for the host architecture into the NEW `/var/www/bills.voltronix_ae/runtime/node` path. Verify its release checksum/signature under the operator's approved provenance process. Do not run a remote installer script, replace `/usr/bin/node`, change shell profiles, change global package links or upgrade another app. If the runtime path exists, stop. Version-selection, download and certificate authenticity are manual prerequisites; no network installation occurred during this task.

```bash
node_bin=/var/www/bills.voltronix_ae/runtime/node/bin/node
npm_cli=/var/www/bills.voltronix_ae/runtime/node/lib/node_modules/npm/bin/npm-cli.js
"$node_bin" --version
"$node_bin" "$npm_cli" --version
```

Verify Node reports 24.x, then work as a nonroot build operator in a new private directory on the same Linux architecture as the target. Substitute the recorded source archive basename:

```bash
set -euo pipefail
incoming=/approved/new-private-incoming
archive_name=bills-crm-source.zip
cd "$incoming"
sha256sum -c "$archive_name.sha256"
unzip -Z1 "$archive_name"   # verify only the bills-crm-source/ root
build_root=$(mktemp -d /tmp/bills-build.XXXXXXXX)
chmod 0700 "$build_root"
unzip -q -n "$incoming/$archive_name" -d "$build_root"
source_root=$build_root/bills-crm-source
cd "$source_root"
```

Continue the following sections in the same dedicated operator shell so the recorded paths remain available; use `set -euo pipefail` and stop on every failure. The independently reviewed, checksummed archive must contain regular files/directories only. After extraction, verify each source hash before installing dependencies:

```bash
"$node_bin" --input-type=module -e '
import fs from "node:fs";
import crypto from "node:crypto";
const manifest = JSON.parse(fs.readFileSync("FILE-MANIFEST.json", "utf8"));
for (const f of manifest.files) {
  if (typeof f.path !== "string" || /[\\:\x00-\x1f\x7f]/.test(f.path)
    || f.path.split("/").some(p => !p || p === "." || p === "..")) throw Error("Invalid manifest path");
  const parts = f.path.split("/");
  for (let i = 1; i < parts.length; i++) {
    const parent = fs.lstatSync(parts.slice(0, i).join("/"));
    if (!parent.isDirectory() || parent.isSymbolicLink()) throw Error("Unexpected parent directory");
  }
  const s = fs.lstatSync(f.path);
  if (!s.isFile() || s.isSymbolicLink()) throw Error("Unexpected file type");
  const b = fs.readFileSync(f.path);
  if (b.length !== f.bytes || crypto.createHash("sha256").update(b).digest("hex") !== f.sha256) throw Error("Hash mismatch");
}
console.log("Source manifest hashes verified:", manifest.files.length);
'
```

Use the lockfile without unrelated upgrades. Installation may need approved registry access; skipped dependency lifecycle scripts mean native-module requirements must be verified separately. Do not copy Windows node_modules or compiled native binaries. Use explicit build-only process settings; `env -i` prevents unrelated inherited app settings:

```bash
env -i HOME="$HOME" PATH="$(dirname "$node_bin"):/usr/bin:/bin" \
  "$node_bin" "$npm_cli" ci --ignore-scripts --include=dev --no-audit --no-fund
env -i HOME="$HOME" PATH="$(dirname "$node_bin"):/usr/bin:/bin" \
  NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 \
  APP_ORIGIN=https://bills.voltronix.ae CRM_FRONTEND_BACKEND=express \
  CRM_EXPRESS_ORIGIN=http://127.0.0.1:3302 CRM_API_INSTANCE_ID=bills-crm \
  CRM_WEB_HOST=127.0.0.1 CRM_WEB_PORT=3301 \
  CRM_DATABASE_MODE=disabled CRM_MYSQL_NETWORK_DISABLED=1 ZOHO_ENABLED=false \
  "$node_bin" tools/run-bills.mjs build
test -f .next/BUILD_ID
test -f server/dist/server.js
test -d shared/contracts/dist
```

The Linux build is required even when local Windows checks passed. The host must already have an approved ZIP extraction utility; this guide does not install operating-system packages. Runtime needs `.next/`, `server/dist/`, `shared/contracts/` and its `dist/`, Linux `node_modules`, root configuration/package files, startup tools and the approved public/PDF font assets. Keep the immutable source manifest and build receipt. Private PDF marks and historical attachments are not provisioned by this foundation. No migration, seed, demo initializer or Zoho setup command belongs in install/build/start.

## 5. New release and separate services

Only after all new path/user checks pass, create Bills-only resources. These commands fail their prerequisites when names already exist; do not bypass the checks:

```bash
target=/var/www/bills.voltronix_ae
release_dir=$target/bills-releases/$release_id
test -d "$target"
test ! -L "$target"
for path in "$target/bills-releases" "$target/bills-current" /etc/bills-crm; do
  test ! -e "$path"
  test ! -L "$path"
done
if getent passwd bills-crm-web; then exit 1; fi
if getent passwd bills-crm-api; then exit 1; fi
if getent group bills-crm-web; then exit 1; fi
if getent group bills-crm-api; then exit 1; fi
sudo useradd --system --user-group --no-create-home --shell /usr/sbin/nologin bills-crm-web
sudo useradd --system --user-group --no-create-home --shell /usr/sbin/nologin bills-crm-api
sudo install -d -m 0755 "$target/bills-releases" "$release_dir"
sudo cp -a --no-preserve=ownership "$source_root/." "$release_dir/"
sudo chmod 0755 "$release_dir"
sudo install -d -m 0700 /etc/bills-crm
sudo install -o root -g root -m 0600 "$release_dir/deploy/ubuntu/bills-web.env.example" /etc/bills-crm/frontend.env
sudo install -o root -g root -m 0600 "$release_dir/deploy/ubuntu/bills-api.env.example" /etc/bills-crm/backend.env
sudo install -d -o bills-crm-web -g bills-crm-web -m 0700 "$release_dir/.next/cache"
sudo ln -s "$release_dir" "$target/bills-current"
sudo -u bills-crm-web test -r "$release_dir/.next/BUILD_ID"
sudo -u bills-crm-api test -r "$release_dir/server/dist/server.js"
```

Review access modes in the NEW release: service users need read/traverse access to source, dependencies and compiled assets; only the web cache is service-writable. Never recursively chown/chmod the existing target or its legacy children. Node native modules may require executable files; preserve build modes. Review the two environment files against [the environment contract](backend-production-environment.md), keeping database disabled and no credentials present.

Check both proposed unit paths are absent, inspect exact unit text, then validate and install only the Bills services:

```bash
test ! -e /etc/systemd/system/bills-crm-api.service
test ! -L /etc/systemd/system/bills-crm-api.service
test ! -e /etc/systemd/system/bills-crm-web.service
test ! -L /etc/systemd/system/bills-crm-web.service
sudo systemd-analyze verify "$release_dir/deploy/ubuntu/bills-crm-api.service" "$release_dir/deploy/ubuntu/bills-crm-web.service"
sudo install -o root -g root -m 0644 "$release_dir/deploy/ubuntu/bills-crm-api.service" /etc/systemd/system/bills-crm-api.service
sudo install -o root -g root -m 0644 "$release_dir/deploy/ubuntu/bills-crm-web.service" /etc/systemd/system/bills-crm-web.service
sudo systemctl daemon-reload
sudo systemctl start bills-crm-api.service
sudo systemctl start bills-crm-web.service
sudo systemctl status bills-crm-api.service bills-crm-web.service --no-pager
```

Do not enable boot startup or change public routing until isolated acceptance. A failed configuration/port/identity preflight is a stop signal; inspect only Bills logs (`journalctl -u bills-crm-api -u bills-crm-web`) privately, never dump entire environments or credential-bearing requests.

## 6. Local foundation smoke checks

These future operator probes use only the new loopback listeners and do not log in, create records or contact the legacy database:

```bash
curl --noproxy '*' --fail --silent --show-error http://127.0.0.1:3302/api/v1/health/live
curl --noproxy '*' --fail --silent --show-error http://127.0.0.1:3302/api/v1/health/identity
curl --noproxy '*' --silent --output /dev/null --write-out '%{http_code}\n' http://127.0.0.1:3302/api/v1/health/ready
curl --noproxy '*' --fail --silent --show-error http://127.0.0.1:3301/api/health/live
curl --noproxy '*' --silent --output /dev/null --write-out '%{http_code}\n' http://127.0.0.1:3301/login
curl --noproxy '*' --silent --output /dev/null --write-out '%{http_code}\n' http://127.0.0.1:3301/api/auth/me
```

Expect API liveness 200, exact instance ID `bills-crm` and origin `https://bills.voltronix.ae`, readiness **503**, web liveness/login **200**, and authentication **503**. Inspect responses and Bills logs for redacted diagnostics. Readiness 200 would be unexpected in disabled mode and requires investigation. Home/data pages cannot provide a functioning CRM without persistence; do not treat a login page as acceptance of authenticated workflows. Production secure cookies must be tested later over approved HTTPS, never weakened for HTTP convenience.

## 7. DNS, certificate and separate Nginx configuration

The owner must verify DNS A/AAAA records, actual server addresses, domain control, certificate hostname/chain/expiry, key permissions and renewal before applying the HTTPS template. No certificate is assumed to exist. Provision certificates through an independently reviewed procedure that does not modify any existing site's configuration. Do not start the HTTPS example with nonexistent certificate paths. Its bounded ACME directory is optional; no challenge client or public directory is created by this task.

Review `deploy/ubuntu/nginx.conf.example`: only `bills.voltronix.ae`, dedicated upstream/log names, no `default_server` or wildcard, no PHP handler, no public API/database upstream and no alias to uploads or source. It must be included exactly once in the existing `http {}` context. Confirm no conflicting Bills virtual host already exists; if there is one, stop for an explicit, separately reviewed traffic-switch plan. The template does not replace `/etc/nginx/nginx.conf` or `crm.voltronix.ae` configuration.

After private loopback acceptance, TLS prerequisites and explicit approval to expose the foundation, install a NEW dedicated file/link only if both paths are absent:

```bash
test ! -e /etc/nginx/sites-available/bills-crm.conf
test ! -L /etc/nginx/sites-available/bills-crm.conf
test ! -e /etc/nginx/sites-enabled/bills-crm.conf
test ! -L /etc/nginx/sites-enabled/bills-crm.conf
sudo install -o root -g root -m 0644 "$release_dir/deploy/ubuntu/nginx.conf.example" /etc/nginx/sites-available/bills-crm.conf
sudo ln -s /etc/nginx/sites-available/bills-crm.conf /etc/nginx/sites-enabled/bills-crm.conf
sudo nginx -t
# Only after a successful test with no conflicting-host warnings and approval:
sudo systemctl reload nginx
```

A reload affects the shared Nginx master, so it requires explicit operator approval and configuration review even though only a new Bills virtual host is added. Never restart Nginx or unrelated services as a shortcut. If `nginx -t` fails, do not reload; follow the scoped rollback below. After acceptance, optional HSTS is a deliberate edit to the new Bills file only (without `includeSubDomains` or preload), followed by another `nginx -t` and approved reload.

The operator's later HTTPS checks must verify the hostname/certificate, redirect, secure headers and asset loading, and confirm existing CRM behavior using the established nonmutating health checks. Keep foundation readiness 503 visible; do not claim users can work until database/history gates close. Only then consider `systemctl enable bills-crm-api.service bills-crm-web.service` under the separate acceptance decision.

## 8. Roll back only the newly introduced Bills components

Keep receipts of every new file/symlink/service and previous Bills release target. Stop only the new Bills units:

```bash
sudo systemctl stop bills-crm-web.service bills-crm-api.service
```

If this procedure introduced the Nginx link, verify it resolves to the exact new Bills file, then unlink just that link, validate the full configuration and request the approved reload:

```bash
test "$(readlink /etc/nginx/sites-enabled/bills-crm.conf)" = /etc/nginx/sites-available/bills-crm.conf
sudo unlink /etc/nginx/sites-enabled/bills-crm.conf
sudo nginx -t
sudo systemctl reload nginx
```

Run that block only when the recorded new link exists; never remove an older operator-managed host. If these new services were enabled after acceptance, disable only those names. Preserve the release, runtime, environments and failure logs for review. For a first installation, verify `bills-current` still points to the recorded `$release_dir` before unlinking it; do not remove directories or original files. For a later Bills-only upgrade, switch only this dedicated symlink back to the recorded accepted Bills release, then start only Bills services and repeat the loopback checks.

Do not restore, roll back or touch the legacy database: this foundation performed no database changes. Confirm database mode/network veto remained enabled, no credentials were provisioned, no database command was run, and original directory/config/service baselines remain intact. A claim of unchanged live business rows needs the owner's independent evidence; legitimate legacy activity may continue. Do not freeze or overwrite it to make a checksum match.
