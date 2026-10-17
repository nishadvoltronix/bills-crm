#!/bin/bash
# Host controller: install OUTSIDE the fetch checkout and releases after review.
# No initial adoption. A human-operated accepted release must already exist.
# All initial paths, PM2 process ownership, database acceptance, PM2 dump backup,
# reverse-proxy reachability and reboot startup must be verified before enabling.
#
# accepted.json is private NONSECRET state, written initially only after acceptance:
# {version:1,appOrigin:"https://hub.voltronix.ae",instanceId:"hub-crm",
#  releaseDir:"/var/www/hub.voltronix_ae/releases/YYYYMMDDTHHMMSSZ-<40sha>-<8hex>",
#  commit:"<40sha>",repairCommit:"<40sha>",acceptedAt:"<ISO UTC>",
#  launcherSha256:"<64hex>",ecosystemSha256:"<64hex>",
#  nodeBin:"<canonical Node 24 path>",pm2Bin:"<canonical PM2 path>",
#  configIdentity:{backend:[dev,ino,size,mtimeMs,ctimeMs,mode,uid],
#                  frontend:[dev,ino,size,mtimeMs,ctimeMs,mode,uid]}}
# The current symlink must identify that release, and both online PM2 definitions
# must exactly use that release's run-hub.mjs and their own external env-file.
# Keep initial and accepted state receipts with restricted backups.
set -Ee -o pipefail
umask 077

# Only vetted executable overrides survive. No shell sourcing of environment data.
if [[ $# -eq 0 ]]; then
    NODE_BIN="$(printenv HUB_NODE_BIN || printf '%s' /var/www/hub.voltronix_ae/runtime/node/bin/node)"
    PM2_BIN="$(printenv HUB_PM2_BIN || printf '%s' /usr/local/bin/pm2)"
    exec /usr/bin/env -i HOME=/home/rjpmadmin USER=rjpmadmin LOGNAME=rjpmadmin \
        PATH=/usr/local/bin:/usr/bin:/bin PM2_HOME=/home/rjpmadmin/.pm2 \
        HUB_NODE_BIN="$NODE_BIN" HUB_PM2_BIN="$PM2_BIN" \
        /bin/bash --noprofile --norc "$0" --sanitized
fi
[[ $# -eq 1 && "$1" == --sanitized ]] || exit 64
set -u
readonly HOME_DIR=/home/rjpmadmin
readonly REPO=/home/rjpmadmin/voltronix-hub-deployment/source
readonly APP=/var/www/hub.voltronix_ae
readonly RELEASES=/var/www/hub.voltronix_ae/releases
readonly STATE=/home/rjpmadmin/hub-deploy-state
readonly LOGS=/home/rjpmadmin/hub-deploy-logs
readonly CONFIG=/home/rjpmadmin/hub-config
readonly ACCEPTED=/home/rjpmadmin/hub-deploy-state/accepted.json
[[ "$(id -un)" == rjpmadmin && "$(id -u)" != 0 ]] || { printf '%s\n' "HUB deploy requires rjpmadmin."; exit 1; }
[[ "$HUB_NODE_BIN" == /* && "$HUB_PM2_BIN" == /* ]] || exit 1
# npm commonly installs a PM2 symlink. Resolve it, then validate the canonical
# executable and every parent BEFORE executing any operator-supplied runtime.
HUB_NODE_BIN="$(readlink -f -- "$HUB_NODE_BIN")"
HUB_PM2_BIN="$(readlink -f -- "$HUB_PM2_BIN")"
safe_executable() {
    local target="$1" cursor="$1" owner mode
    [[ -f "$target" && -x "$target" && ! -L "$target" && "$(stat -c %h -- "$target")" == 1 ]] || return 1
    while true; do
        owner="$(stat -c %u -- "$cursor")"
        mode="$(stat -c %a -- "$cursor")"
        [[ "$owner" == 0 || "$owner" == "$(id -u)" ]] || return 1
        (( (8#$mode & 8#022) == 0 )) || return 1
        [[ "$cursor" == / ]] && break
        cursor="$(dirname "$cursor")"
    done
}
safe_executable "$HUB_NODE_BIN"
safe_executable "$HUB_PM2_BIN"
[[ -x "$HUB_NODE_BIN" && -f "$HUB_NODE_BIN" && -x "$HUB_PM2_BIN" && -f "$HUB_PM2_BIN" ]] || exit 1
[[ "$("$HUB_NODE_BIN" -p 'process.versions.node.split(".")[0]')" == 24 ]] || exit 1
export PATH="$(dirname "$HUB_NODE_BIN"):/usr/local/bin:/usr/bin:/bin"

# This helper never reads backend.env contents. Only the backend child launcher
# consumes credentials. PM2 JSON is parsed in memory, never echoed or saved here.
HELPER="$(cat <<'NODE'
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const [command, ...args] = process.argv.slice(1);
const home = "/home/rjpmadmin", app = "/var/www/hub.voltronix_ae";
const stateDir = home + "/hub-deploy-state", acceptedPath = stateDir + "/accepted.json";
const configDir = home + "/hub-config";
const uid = process.getuid();
const hash = value => crypto.createHash("sha256").update(value).digest("hex");
const fail = () => { throw Error("HUB deployment precondition or acceptance check failed."); };
function safe(filename, directory = false, privateFile = false) {
  if (!path.isAbsolute(filename) || fs.realpathSync(filename) !== filename) fail();
  let cursor = filename;
  while (true) {
    const stat = fs.lstatSync(cursor);
    if (stat.isSymbolicLink() || ![0, uid].includes(stat.uid)
      || (stat.mode & (cursor === filename && privateFile ? 0o077 : 0o022))) fail();
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  const stat = fs.lstatSync(filename);
  if (directory ? !stat.isDirectory() : !stat.isFile() || stat.nlink !== 1) fail();
  return stat;
}
function release(filename) {
  if (!/^\/var\/www\/hub\.voltronix_ae\/releases\/[0-9]{8}T[0-9]{6}Z-[a-f0-9]{40}-[a-f0-9]{8}$/.test(filename)) fail();
  safe(filename, true);
  return filename;
}
function configIdentity() {
  return Object.fromEntries(["backend", "frontend"].map(role => {
    const stat = safe(configDir + "/" + role + ".env", false, true);
    return [role, [stat.dev, stat.ino, stat.size, stat.mtimeMs, stat.ctimeMs, stat.mode, stat.uid]];
  }));
}
function digest(filename) { safe(filename); return hash(fs.readFileSync(filename)); }
function loadState(checkCurrent = true) {
  safe(acceptedPath, false, true);
  if (fs.statSync(acceptedPath).size > 8192) fail();
  const value = JSON.parse(fs.readFileSync(acceptedPath, "utf8"));
  const keys = ["version","appOrigin","instanceId","releaseDir","commit","repairCommit","acceptedAt","launcherSha256","ecosystemSha256","nodeBin","pm2Bin","configIdentity"];
  if (Object.keys(value).sort().join() !== keys.sort().join() || value.version !== 1
    || value.appOrigin !== "https://hub.voltronix.ae" || value.instanceId !== "hub-crm"
    || !/^[a-f0-9]{40}$/.test(value.commit) || !/^[a-f0-9]{40}$/.test(value.repairCommit)
    || !Number.isFinite(Date.parse(value.acceptedAt))
    || value.nodeBin !== process.env.HUB_NODE_BIN || value.pm2Bin !== process.env.HUB_PM2_BIN
    || !/^[a-f0-9]{64}$/.test(value.launcherSha256) || !/^[a-f0-9]{64}$/.test(value.ecosystemSha256)) fail();
  release(value.releaseDir);
  if (path.basename(value.releaseDir).split("-")[1] !== value.commit
    || value.launcherSha256 !== digest(value.releaseDir + "/tools/run-hub.mjs")
    || value.ecosystemSha256 !== digest(value.releaseDir + "/deploy/ubuntu/hub-ecosystem.config.cjs")
    || JSON.stringify(value.configIdentity) !== JSON.stringify(configIdentity())) fail();
  if (checkCurrent && (!fs.lstatSync(app + "/current").isSymbolicLink()
    || fs.readlinkSync(app + "/current") !== value.releaseDir)) fail();
  return value;
}
async function bytes(response, limit) {
  const reader = response.body?.getReader();
  if (!reader) fail();
  const parts = []; let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.length;
      if (size > limit) fail();
      parts.push(Buffer.from(part.value));
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  return Buffer.concat(parts);
}
async function request(origin, pathname, limit = 4096) {
  const url = new URL(pathname, origin);
  // Direct API health routes deliberately reject all query strings. Only paths
  // through the web/CDN receive a nonce; loopback requests bypass every cache.
  if (origin !== "http://127.0.0.1:3002") url.searchParams.set("hub_deploy_probe", crypto.randomUUID());
  const response = await fetch(url, {
    redirect: "manual", cache: "no-store", credentials: "omit",
    signal: AbortSignal.timeout(6000),
    headers: { "cache-control": "no-cache, no-store", pragma: "no-cache", origin: "https://hub.voltronix.ae" },
  });
  return { response, body: await bytes(response, limit) };
}
async function json(origin, pathname, status) {
  const result = await request(origin, pathname);
  if (result.response.status !== status || result.response.headers.has("set-cookie")
    || result.response.headers.get("content-type")?.split(";")[0].trim() !== "application/json") fail();
  return JSON.parse(result.body.toString("utf8"));
}
async function api() {
  const identity = await json("http://127.0.0.1:3002", "/api/v1/health/identity", 200);
  if (JSON.stringify(Object.keys(identity).sort()) !== JSON.stringify(["appOrigin","instanceId","service"])
    || identity.service !== "bills-crm-api" || identity.instanceId !== "hub-crm"
    || identity.appOrigin !== "https://hub.voltronix.ae") fail();
  const ready = await json("http://127.0.0.1:3002", "/api/v1/health/ready", 200);
  if (Object.keys(ready).join() !== "status" || ready.status !== "ready") fail();
  const denied = await json("http://127.0.0.1:3002", "/api/v1/auth/me", 401);
  if (typeof denied.error !== "string" || Object.hasOwn(denied, "user")) fail();
}
async function website(origin, directory, expectedAssets) {
  const page = await request(origin, "/login", 2 * 1024 * 1024);
  const html = page.body.toString("utf8");
  if (page.response.status !== 200 || !page.response.headers.get("content-type")?.startsWith("text/html")
    || !/<form[\s>]/i.test(html) || !/type="email"/.test(html) || !/type="password"/.test(html)) fail();
  // Public HTML must reference the same full Next asset set as the direct
  // candidate page. Hash EVERY referenced asset against this candidate release.
  const assets = [...new Set([...html.matchAll(/(?:src|href)="(\/_next\/static\/[^"?#]+\.(?:js|css))(?:\?[^"]*)?"/g)].map(match => match[1]))].sort();
  if (!assets.length || assets.length > 128 || (expectedAssets && JSON.stringify(assets) !== JSON.stringify(expectedAssets))) fail();
  for (const pathname of assets) {
    if (/%|\\|\.\./.test(pathname)) fail();
    const local = directory + "/.next/static/" + pathname.slice("/_next/static/".length);
    safe(local);
    const asset = await request(origin, pathname, 10 * 1024 * 1024);
    if (asset.response.status !== 200 || hash(asset.body) !== digest(local)) fail();
  }
  const denied = await json(origin, "/api/auth/me", 401);
  if (typeof denied.error !== "string" || Object.hasOwn(denied, "user")) fail();
  return assets;
}
function processDefinitions(allowed, required) {
  const definitions = JSON.parse(fs.readFileSync(0, "utf8"));
  if (!Array.isArray(definitions)) fail();
  const found = [];
  for (const [name, role] of [["voltronix-hub","web"],["hub-api","api"]]) {
    const matches = definitions.filter(item => item.name === name);
    if (matches.length > 1 || (required && matches.length !== 1)) fail();
    if (!matches.length) continue;
    const item = matches[0], environment = item.pm2_env;
    if (!environment || !allowed.includes(environment.pm_cwd)
      || environment.pm_exec_path !== environment.pm_cwd + "/tools/run-hub.mjs"
      || environment.exec_interpreter !== process.env.HUB_NODE_BIN
      || environment.exec_mode !== "fork_mode"
      || JSON.stringify(environment.args) !== JSON.stringify([role, "--env-file", configDir + "/" + (role === "api" ? "backend" : "frontend") + ".env"])
      || (required && environment.status !== "online")) fail();
    found.push(name);
  }
  return found;
}
async function main() {
  if (command === "preflight") {
    for (const directory of [home, app, app + "/releases", stateDir, home + "/hub-deploy-logs", configDir, home + "/voltronix-hub-deployment/source"]) safe(directory, true, directory === stateDir || directory === home + "/hub-deploy-logs");
    if (fs.existsSync(stateDir + "/blocked.json")) fail();
    for (const filename of [process.env.HUB_NODE_BIN, process.env.HUB_PM2_BIN]) safe(filename);
    const value = loadState();
    console.log([value.releaseDir, value.commit, value.repairCommit].join("\n"));
  } else if (command === "candidate") {
    const directory = release(args[0]);
    for (const filename of ["tools/run-hub.mjs","tools/hub-deployment.test.mjs","deploy/ubuntu/hub-deploy.sh","deploy/ubuntu/hub-ecosystem.config.cjs","package-lock.json"]) safe(directory + "/" + filename);
    for (const root of [directory, directory + "/server"]) {
      for (const name of fs.readdirSync(root)) if (name.toLowerCase().startsWith(".env") && name !== ".env.example") fail();
    }
    const manifest = JSON.parse(fs.readFileSync(directory + "/package.json", "utf8"));
    for (const key of ["contracts:build","build:server","typecheck"]) if (typeof manifest.scripts?.[key] !== "string") fail();
  } else if (command === "pm2-required") {
    processDefinitions([release(args[0])], true);
  } else if (command === "pm2-scope") {
    console.log(processDefinitions(args.filter(Boolean).map(release), false).join("\n"));
  } else if (command === "api") {
    await api();
  } else if (command === "websites") {
    release(args[0]);
    await api();
    const assets = await website("http://192.168.30.21:3090", args[0]);
    await website("https://hub.voltronix.ae", args[0], assets);
  } else if (command === "committed") {
    if (loadState().releaseDir !== args[0]) fail();
  } else if (command === "restore-pointer") {
    const previous = loadState(false);
    if (previous.releaseDir !== args[0] || !fs.lstatSync(app + "/current").isSymbolicLink()
      || !args.includes(fs.readlinkSync(app + "/current"))) fail();
    const link = app + "/.hub-restore-" + crypto.randomUUID();
    fs.symlinkSync(previous.releaseDir, link);
    fs.renameSync(link, app + "/current");
  } else if (command === "block") {
    fs.writeFileSync(stateDir + "/blocked.json", JSON.stringify({
      failedAt: new Date().toISOString(), reason: "HUB rollback or ownership validation failed; operator review required.",
    }) + "\n", { flag: "wx", mode: 0o600 });
  } else if (command === "commit") {
    const previous = loadState(), directory = release(args[0]), commit = args[1];
    if (!/^[a-f0-9]{40}$/.test(commit) || path.basename(directory).split("-")[1] !== commit) fail();
    const next = { ...previous, releaseDir: directory, commit, acceptedAt: new Date().toISOString(),
      launcherSha256: digest(directory + "/tools/run-hub.mjs"),
      ecosystemSha256: digest(directory + "/deploy/ubuntu/hub-ecosystem.config.cjs") };
    const suffix = crypto.randomUUID(), temporary = stateDir + "/accepted-" + suffix + ".pending.json";
    const link = app + "/.hub-current-" + suffix;
    // Preserve old receipt; leave all failed/pending artifacts for investigation.
    fs.writeFileSync(stateDir + "/accepted-" + previous.commit + "-" + suffix + ".json", JSON.stringify(previous, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    fs.writeFileSync(temporary, JSON.stringify(next, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    fs.symlinkSync(directory, link);
    fs.renameSync(link, app + "/current");
    try { fs.renameSync(temporary, acceptedPath); }
    catch {
      const restore = app + "/.hub-restore-" + suffix;
      fs.symlinkSync(previous.releaseDir, restore); fs.renameSync(restore, app + "/current");
      fail();
    }
  } else fail();
}
main().catch(() => { console.error("HUB deployment check failed (" + command + "); no private values disclosed."); process.exitCode = 1; });
NODE
)"
helper() { "$HUB_NODE_BIN" -e "$HELPER" "$@"; }
hub_pm2() {
    /usr/bin/env -i HOME="$HOME_DIR" USER=rjpmadmin LOGNAME=rjpmadmin \
        PATH="$PATH" PM2_HOME="$HOME_DIR/.pm2" HUB_NODE_BIN="$HUB_NODE_BIN" \
        HUB_RELEASE_DIR="$PROCESS_RELEASE" "$HUB_PM2_BIN" "$@" 9>&-
}

# Require prepared directories BEFORE opening lock/log files. No mkdir/adoption here.
helper preflight >/dev/null
exec 9>"$STATE/deploy.lock"
flock --nonblock 9 || { printf '%s\n' "HUB deployment already running; skipped."; exit 0; }
INITIAL="$(helper preflight)"
PREVIOUS_RELEASE="$(printf '%s\n' "$INITIAL" | sed -n '1p')"
PREVIOUS_COMMIT="$(printf '%s\n' "$INITIAL" | sed -n '2p')"
REPAIR_COMMIT="$(printf '%s\n' "$INITIAL" | sed -n '3p')"
readonly PREVIOUS_RELEASE PREVIOUS_COMMIT REPAIR_COMMIT
exec > >(tee -a "$LOGS/deploy.log" 9>&-) 2>&1
log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
STAGE=preflight
CANDIDATE=
PROCESS_RELEASE="$PREVIOUS_RELEASE"
ACTIVATING=0
COMMITTED=0
stop_known_hub() {
    local present name
    present="$(hub_pm2 jlist | helper pm2-scope "$PREVIOUS_RELEASE" "$CANDIDATE")" || return 1
    # The helper emits only these two exact names, frontend first.
    for name in $present; do hub_pm2 delete "$name" || return 1; done
}
wait_api() {
    local attempt
    for attempt in $(seq 1 20); do
        if helper api; then return 0; fi
        sleep 2
    done
    return 1
}
wait_websites() {
    local attempt
    for attempt in $(seq 1 10); do
        if helper websites "$PROCESS_RELEASE"; then return 0; fi
        sleep 2
    done
    return 1
}
start_hub() {
    local ecosystem="$PROCESS_RELEASE/deploy/ubuntu/hub-ecosystem.config.cjs"
    hub_pm2 start "$ecosystem" --only hub-api || return 1
    wait_api || return 1
    hub_pm2 start "$ecosystem" --only voltronix-hub || return 1
    wait_websites || return 1
    hub_pm2 jlist | helper pm2-required "$PROCESS_RELEASE"
}
failure() {
    local code="$1"
    trap - ERR INT TERM
    set +e
    log "FAILED stage=$STAGE candidate=$CANDIDATE; retain release and logs."
    # Handle a signal immediately after the accepted manifest was atomically saved.
    if [[ -n "$CANDIDATE" ]] && helper committed "$CANDIDATE" >/dev/null 2>&1; then COMMITTED=1; fi
    if [[ "$ACTIVATING" == 1 && "$COMMITTED" == 0 ]]; then
        log "Restoring both previously accepted HUB process definitions."
        if stop_known_hub && helper restore-pointer "$PREVIOUS_RELEASE" "$CANDIDATE"; then
            PROCESS_RELEASE="$PREVIOUS_RELEASE"
            if start_hub; then
                if hub_pm2 save --force; then log "Rollback healthy; retained commit=$PREVIOUS_COMMIT.";
                else helper block; log "Rollback healthy but PM2 reboot persistence failed; further deployment blocked."; fi
            else helper block; log "ROLLBACK FAILED; further deployment blocked for operator investigation."; fi
        else helper block; log "ROLLBACK REFUSED: HUB process ownership/state changed; further deployment blocked."; fi
    fi
    exit "$code"
}
trap 'failure $?' ERR
trap 'failure 130' INT
trap 'failure 143' TERM

log "Checking accepted HUB main; previous=$PREVIOUS_COMMIT."
hub_pm2 jlist | helper pm2-required "$PREVIOUS_RELEASE"
helper websites "$PREVIOUS_RELEASE"
[[ "$(git -C "$REPO" rev-parse --show-toplevel)" == "$REPO" ]]
[[ "$(git -C "$REPO" remote get-url origin)" =~ ^(https://github.com/nishadvoltronix/hub\.voltronix\.ae(\.git)?|git@github.com:nishadvoltronix/hub\.voltronix\.ae(\.git)?)$ ]]
if [[ -n "$(git -C "$REPO" status --porcelain)" ]]; then
    log "Fetch checkout has local modifications; preserved. Build uses an exact Git archive."
fi
STAGE=fetch
GIT_TERMINAL_PROMPT=0 git -C "$REPO" fetch --no-tags origin refs/heads/main:refs/remotes/origin/main
COMMIT="$(git -C "$REPO" rev-parse --verify refs/remotes/origin/main^{commit})"
[[ "$COMMIT" =~ ^[a-f0-9]{40}$ ]]
if [[ "$COMMIT" == "$PREVIOUS_COMMIT" ]]; then log "No new HUB commit."; exit 0; fi
git -C "$REPO" merge-base --is-ancestor "$REPAIR_COMMIT" "$COMMIT"
git -C "$REPO" merge-base --is-ancestor "$PREVIOUS_COMMIT" "$COMMIT"
git -C "$REPO" cat-file -e "$REPAIR_COMMIT:tools/run-hub.mjs"
git -C "$REPO" cat-file -e "$REPAIR_COMMIT:deploy/ubuntu/hub-deploy.sh"
STAGE=archive
SUFFIX="$("$HUB_NODE_BIN" -p 'require("node:crypto").randomBytes(4).toString("hex")')"
CANDIDATE="$RELEASES/$(date -u +%Y%m%dT%H%M%SZ)-$COMMIT-$SUFFIX"
mkdir -m 0750 "$CANDIDATE"
git -C "$REPO" archive --format=tar "$COMMIT" | tar -x -C "$CANDIDATE" --no-same-owner
helper candidate "$CANDIDATE"
STAGE=build-and-test
(
    exec 9>&-
    cd "$CANDIDATE"
    # No backend file is sourced, passed to npm, or read during this stage.
    /usr/bin/env -i HOME="$HOME_DIR" USER=rjpmadmin LOGNAME=rjpmadmin PATH="$PATH" \
        NEXT_TELEMETRY_DISABLED=1 npm ci --no-audit --no-fund
    /usr/bin/env -i HOME="$HOME_DIR" PATH="$PATH" \
        "$HUB_NODE_BIN" tools/run-hub.mjs build --env-file "$CONFIG/frontend.env"
    # Explicit public-source gates. Full historical suites require private PDF
    # company marks and are not silently skipped, patched or imported here.
    /usr/bin/env -i HOME="$HOME_DIR" PATH="$PATH" \
        "$HUB_NODE_BIN" --test tools/run-hub.test.mjs tools/hub-deployment.test.mjs
    (
        cd server
        /usr/bin/env -i HOME="$HOME_DIR" PATH="$PATH" \
            "$HUB_NODE_BIN" --import tsx --test --test-concurrency=2 \
            tests/config.test.ts tests/environment.test.ts tests/production-environment.test.ts \
            tests/production-runtime.test.ts tests/runtime-configuration.test.ts \
            tests/runtime-database-lifecycle.test.ts tests/runtime-database-compatibility.test.ts \
            tests/runtime-privileges.test.ts tests/runtime-migrations.test.ts \
            tests/mysql-operator.test.ts tests/mysql-target-migrations.test.ts \
            tests/bootstrap-admin.test.ts tests/auth-http.test.ts
    )
    /usr/bin/env -i HOME="$HOME_DIR" PATH="$PATH" \
        "$HUB_NODE_BIN" --import tsx --test --test-concurrency=2 \
        tests/frontend-environment.test.ts tests/express-frontend.test.ts \
        tests/express-https.test.ts tests/express-identity.test.ts
    /usr/bin/env -i HOME="$HOME_DIR" PATH="$PATH" NEXT_TELEMETRY_DISABLED=1 npm run typecheck
)
helper preflight >/dev/null
hub_pm2 jlist | helper pm2-required "$PREVIOUS_RELEASE"
helper websites "$PREVIOUS_RELEASE"
STAGE=activate
ACTIVATING=1
stop_known_hub
PROCESS_RELEASE="$CANDIDATE"
start_hub
STAGE=persist
# Save updates only after genuine readiness/site checks. Other process definitions
# are retained unchanged; their startup service must have been reviewed initially.
hub_pm2 save --force
helper commit "$CANDIDATE" "$COMMIT"
COMMITTED=1
log "Accepted HUB commit=$COMMIT release=$CANDIDATE; previous healthy release retained."
