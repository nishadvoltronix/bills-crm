import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import test from "node:test";

const scriptUrl = new URL("../deploy/ubuntu/hub-deploy.sh", import.meta.url);
const script = readFileSync(scriptUrl, "utf8");
const helper = script.split("HELPER=\"$(cat <<'NODE'\n")[1]?.split("\nNODE\n)\"")[0];
const ecosystem = readFileSync(new URL("../deploy/ubuntu/hub-ecosystem.config.cjs", import.meta.url), "utf8");
const nativeRequire = createRequire(import.meta.url);
const home = "/home/rjpmadmin", app = "/var/www/hub.voltronix_ae";
const previousCommit = "a".repeat(40), nextCommit = "b".repeat(40);
const previous = app + "/releases/20261017T080000Z-" + previousCommit + "-12345678";
const candidate = app + "/releases/20261017T090000Z-" + nextCommit + "-87654321";
const node = app + "/runtime/node/bin/node", pm2 = "/usr/local/bin/pm2";
const sha = value => createHash("sha256").update(value).digest("hex");

function fixture() {
  const files = new Map(), reads = [], writes = [], logs = [], requests = [];
  let inode = 1, rejectStateRename = false;
  function add(filename, body = null, mode = body === null ? 0o755 : 0o644) {
    if (!files.has(filename)) files.set(filename, { body, mode, inode: inode++ });
    const parent = path.posix.dirname(filename);
    if (parent !== filename) add(parent);
  }
  for (const directory of [home, app, app + "/releases", home + "/hub-config",
    home + "/hub-deploy-state", home + "/hub-deploy-logs", home + "/voltronix-hub-deployment/source"]) {
    add(directory, null, directory.includes("hub-deploy-") || directory.endsWith("hub-config") ? 0o700 : 0o755);
  }
  add(node, "node", 0o755); add(pm2, "pm2", 0o755);
  add(home + "/hub-config/backend.env", "sensitive-fixture-never-read", 0o600);
  add(home + "/hub-config/frontend.env", "nonsecret-fixture", 0o600);
  for (const directory of [previous, candidate]) {
    add(directory);
    for (const filename of ["tools/run-hub.mjs", "tools/hub-deployment.test.mjs",
      "deploy/ubuntu/hub-deploy.sh", "deploy/ubuntu/hub-ecosystem.config.cjs", "package-lock.json"]) {
      add(directory + "/" + filename, "reviewed source:" + filename);
    }
    add(directory + "/server");
    add(directory + "/.next/static/chunks/common.js", "shared identical vendor asset");
    add(directory + "/.next/static/chunks/release.js", "asset:" + directory);
    add(directory + "/package.json", JSON.stringify({ scripts: {
      "contracts:build": "fixture", "build:server": "fixture", typecheck: "fixture",
    } }));
  }
  function stat(filename) {
    const value = files.get(filename);
    if (!value) throw Error("fixture ENOENT");
    return {
      dev: 1, ino: value.inode, size: value.body?.length ?? 0, mtimeMs: 100, ctimeMs: 100,
      mode: value.mode, uid: 1000, nlink: 1,
      isSymbolicLink: () => Boolean(value.target),
      isDirectory: () => value.body === null && !value.target,
      isFile: () => value.body !== null && !value.target,
    };
  }
  const fs = {
    existsSync: filename => files.has(filename),
    lstatSync: stat, statSync: stat,
    realpathSync(filename) { if (!files.has(filename)) throw Error("fixture ENOENT"); return files.get(filename).target ?? filename; },
    readlinkSync: filename => files.get(filename)?.target,
    readFileSync(filename) {
      if (filename === 0) return fixtureState.stdin;
      reads.push(filename);
      if (!files.has(filename)) throw Error("fixture ENOENT");
      return files.get(filename).body;
    },
    readdirSync(directory) {
      return [...files.keys()].filter(filename => path.posix.dirname(filename) === directory && filename !== directory).map(filename => path.posix.basename(filename));
    },
    writeFileSync(filename, body, options) {
      if (options.flag === "wx" && files.has(filename)) throw Error("fixture EEXIST");
      writes.push(filename); add(filename, body, options.mode);
    },
    symlinkSync(target, filename) {
      if (files.has(filename)) throw Error("fixture EEXIST");
      files.set(filename, { target, body: null, mode: 0o777, inode: inode++ });
    },
    renameSync(from, to) {
      if (rejectStateRename && to === home + "/hub-deploy-state/accepted.json") throw Error("fixture rename denied");
      if (!files.has(from)) throw Error("fixture ENOENT");
      files.set(to, files.get(from)); files.delete(from);
    },
  };
  const configIdentity = Object.fromEntries(["backend", "frontend"].map(role => {
    const value = stat(home + "/hub-config/" + role + ".env");
    return [role, [value.dev, value.ino, value.size, value.mtimeMs, value.ctimeMs, value.mode, value.uid]];
  }));
  const accepted = {
    version: 1, appOrigin: "https://hub.voltronix.ae", instanceId: "hub-crm",
    releaseDir: previous, commit: previousCommit, repairCommit: previousCommit,
    acceptedAt: "2026-10-17T08:00:00.000Z",
    launcherSha256: sha(files.get(previous + "/tools/run-hub.mjs").body),
    ecosystemSha256: sha(files.get(previous + "/deploy/ubuntu/hub-ecosystem.config.cjs").body),
    nodeBin: node, pm2Bin: pm2, configIdentity,
  };
  add(home + "/hub-deploy-state/accepted.json", JSON.stringify(accepted), 0o600);
  fs.symlinkSync(previous, app + "/current");
  const fixtureState = { stdin: "[]", fetcher: async () => { throw Error("network disabled"); } };
  async function run(command, ...args) {
    let exitCode = 0;
    const context = {
      require(name) { if (name === "node:fs") return fs; if (name === "node:path") return path.posix; return nativeRequire(name); },
      process: { argv: ["node", command, ...args], env: { HUB_NODE_BIN: node, HUB_PM2_BIN: pm2 }, getuid: () => 1000,
        set exitCode(value) { exitCode = value; } },
      console: { log: value => logs.push(String(value)), error: value => logs.push(String(value)) },
      fetch: async (url, options) => { requests.push({ url: String(url), options }); return fixtureState.fetcher(url, options); },
      AbortSignal, Buffer, URL,
    };
    await vm.runInNewContext(helper, context);
    return exitCode;
  }
  function definitions(directory = previous) {
    return [["voltronix-hub", "web"], ["hub-api", "api"]].map(([name, role]) => ({ name, pm2_env: {
      pm_cwd: directory, pm_exec_path: directory + "/tools/run-hub.mjs", exec_interpreter: node,
      exec_mode: "fork_mode", status: "online",
      args: [role, "--env-file", home + "/hub-config/" + (role === "api" ? "backend" : "frontend") + ".env"],
    } }));
  }
  return { files, reads, writes, logs, requests, fs, accepted, run, definitions, fixtureState,
    rejectStateRename() { rejectStateRename = true; } };
}

test("deployment helper requires an accepted release and never reads backend credentials", async () => {
  assert.ok(helper, "extract embedded helper");
  const f = fixture();
  assert.equal(await f.run("preflight"), 0);
  assert.equal(f.logs[0], [previous, previousCommit, previousCommit].join("\n"));
  assert.ok(!f.reads.includes(home + "/hub-config/backend.env"));
  f.files.delete(home + "/hub-deploy-state/accepted.json");
  assert.equal(await f.run("preflight"), 1);
  assert.deepEqual(f.writes, []);
  assert.ok(f.logs.every(line => !line.includes("sensitive-fixture")));
});

test("changed configuration, launcher bytes, pointers and blocked recovery refuse adoption", async () => {
  for (const mutate of [
    f => { f.files.get(home + "/hub-config/backend.env").inode++; },
    f => { f.files.get(previous + "/tools/run-hub.mjs").body += "modified"; },
    f => { f.files.get(app + "/current").target = candidate; },
    f => { f.files.set(home + "/hub-deploy-state/blocked.json", { body: "blocked" }); },
  ]) {
    const f = fixture(); mutate(f);
    assert.equal(await f.run("preflight"), 1);
    assert.deepEqual(f.writes, []);
  }
});

test("deployment requires the existing source checkout and checks its parent without modifying deployment artifacts", async () => {
  assert.match(script, /^readonly REPO=\/home\/rjpmadmin\/voltronix-hub-deployment\/source$/m);
  for (const mutate of [
    f => { f.files.delete(home + "/voltronix-hub-deployment/source"); },
    f => { f.files.get(home + "/voltronix-hub-deployment/source").mode = 0o775; },
    f => { f.files.get(home + "/voltronix-hub-deployment").mode = 0o775; },
  ]) {
    const f = fixture(); mutate(f);
    assert.equal(await f.run("preflight"), 1);
    assert.deepEqual(f.writes, []);
    assert.ok(!f.reads.includes(home + "/hub-config/backend.env"));
  }
});

test("PM2 validation refuses unrelated ownership, duplicates and offline definitions without mutation", async () => {
  const f = fixture();
  f.fixtureState.stdin = JSON.stringify([...f.definitions(), { name: "unrelated", pm2_env: { private: "never-printed" } }]);
  assert.equal(await f.run("pm2-required", previous), 0);
  for (const mutate of [
    values => { values[0].pm2_env.pm_cwd = "/var/www/other"; },
    values => { values[1].pm2_env.args[2] = home + "/hub-config/frontend.env"; },
    values => { values[1].pm2_env.status = "errored"; },
    values => { values.push(values[0]); },
  ]) {
    const values = f.definitions(); mutate(values); f.fixtureState.stdin = JSON.stringify(values);
    assert.equal(await f.run("pm2-required", previous), 1);
  }
  f.fixtureState.stdin = JSON.stringify([f.definitions(candidate)[1]]);
  assert.equal(await f.run("pm2-scope", previous, candidate), 0);
  assert.equal(f.logs.at(-1), "hub-api");
  assert.deepEqual(f.writes, []);
  assert.ok(f.logs.every(line => !line.includes("never-printed")));
});

test("candidate checks refuse an absent repair contract and active dotenv files", async () => {
  const f = fixture();
  assert.equal(await f.run("candidate", candidate), 0);
  f.files.delete(candidate + "/tools/hub-deployment.test.mjs");
  assert.equal(await f.run("candidate", candidate), 1);
  const other = fixture();
  other.files.set(candidate + "/server/.env", { body: "sensitive-fixture" });
  assert.equal(await other.run("candidate", candidate), 1);
});

test("accepted state commits both metadata pointers and retains the old receipt", async () => {
  const f = fixture();
  assert.equal(await f.run("commit", candidate, nextCommit), 0);
  const accepted = JSON.parse(f.files.get(home + "/hub-deploy-state/accepted.json").body);
  assert.equal(accepted.releaseDir, candidate);
  assert.equal(accepted.commit, nextCommit);
  assert.equal(accepted.repairCommit, previousCommit);
  assert.equal(f.files.get(app + "/current").target, candidate);
  assert.ok(f.writes.some(filename => filename.includes("accepted-" + previousCommit)));
  assert.equal(await f.run("committed", candidate), 0);
  assert.ok(!f.reads.includes(home + "/hub-config/backend.env"));
});

test("failed or interrupted state finalization restores the previous pointer", async () => {
  const f = fixture(); f.rejectStateRename();
  assert.equal(await f.run("commit", candidate, nextCommit), 1);
  assert.equal(f.files.get(app + "/current").target, previous);
  assert.equal(JSON.parse(f.files.get(home + "/hub-deploy-state/accepted.json").body).commit, previousCommit);
  f.files.get(app + "/current").target = candidate;
  assert.equal(await f.run("restore-pointer", previous, candidate), 0);
  assert.equal(f.files.get(app + "/current").target, previous);
});

function healthyFetch(f, { staleAsset = false, staleHtml = false, wrongIdentity = false, allowAnonymous = false } = {}) {
  return async url => {
    if (url.pathname === "/api/v1/health/identity") return Response.json({
      service: "bills-crm-api", instanceId: wrongIdentity ? "other" : "hub-crm", appOrigin: "https://hub.voltronix.ae",
    });
    if (url.pathname === "/api/v1/health/ready") return Response.json({ status: "ready" });
    if (url.pathname.endsWith("/auth/me")) return Response.json(
      allowAnonymous ? { user: {} } : { error: "Authentication required." }, { status: allowAnonymous ? 200 : 401 });
    if (url.pathname === "/login") return new Response(
      '<form><input type="email"><input type="password"></form><script src="/_next/static/chunks/common.js"></script>'
      + (staleHtml && url.protocol === "https:" ? "" : '<script src="/_next/static/chunks/release.js"></script>'),
      { headers: { "content-type": "text/html; charset=utf-8" } });
    if (url.pathname === "/_next/static/chunks/common.js") return new Response("shared identical vendor asset");
    if (url.pathname === "/_next/static/chunks/release.js") return new Response(
      f.files.get((staleAsset ? previous : candidate) + "/.next/static/chunks/release.js").body);
    throw Error("unexpected network path");
  };
}

test("direct and HTTPS acceptance validates DB readiness, release asset bytes and anonymous denial", async () => {
  const f = fixture(); f.fixtureState.fetcher = healthyFetch(f);
  assert.equal(await f.run("websites", candidate), 0);
  assert.ok(f.requests.some(item => item.url.startsWith("http://192.168.30.21:3090/")));
  assert.ok(f.requests.some(item => item.url.startsWith("https://hub.voltronix.ae/")));
  const directApi = f.requests.filter(item => item.url.startsWith("http://127.0.0.1:3002/"));
  assert.ok(directApi.every(item => new URL(item.url).search === ""));
  const nonces = f.requests.filter(item => !directApi.includes(item))
    .map(item => new URL(item.url).searchParams.get("hub_deploy_probe"));
  assert.ok(nonces.every(Boolean));
  assert.equal(new Set(nonces).size, nonces.length);
  for (const { options } of f.requests) {
    assert.equal(options.redirect, "manual");
    assert.equal(options.credentials, "omit");
    assert.equal(options.headers["cache-control"], "no-cache, no-store");
    assert.equal(options.headers.cookie, undefined);
  }
  assert.deepEqual(f.writes, []);
});

test("API probe obeys the real Express health URL contract on an owned loopback server", async () => {
  // Protocol-only HTTP evidence. Injected readiness/auth fixtures do not claim a
  // database-backed runtime or production host acceptance.
  const { tsImport } = await import("tsx/esm/api");
  const { createApp } = await tsImport("../server/src/app.ts", import.meta.url);
  let readinessCalls = 0;
  const instance = createApp({
    environment: "production", host: "127.0.0.1", port: 3002,
    appOrigin: "https://hub.voltronix.ae", instanceId: "hub-crm",
  }, { readiness: async () => { readinessCalls++; return true; }, auth: { authenticate: async () => null } });
  const server = createServer(instance);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const origin = "http://127.0.0.1:" + server.address().port;
    const f = fixture();
    f.fixtureState.fetcher = (url, options) => fetch(origin + url.pathname + url.search, options);
    assert.equal(await f.run("api"), 0, f.logs.join("\n"));
    assert.equal(readinessCalls, 1);
    assert.ok(f.requests.every(item => new URL(item.url).search === ""));
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});

test("stale CDN chunks or HTML, wrong API identity and anonymous access fail acceptance", async () => {
  for (const options of [{ staleAsset: true }, { staleHtml: true }, { wrongIdentity: true }, { allowAnonymous: true }]) {
    const f = fixture(); f.fixtureState.fetcher = healthyFetch(f, options);
    assert.equal(await f.run("websites", candidate), 1);
    assert.deepEqual(f.writes, []);
  }
});

test("ecosystem limits changes to HUB processes and never serializes backend credentials", () => {
  const f = fixture(), result = { exports: {} };
  const context = {
    require(name) { if (name === "node:fs") return f.fs; if (name === "node:path") return path.posix; return nativeRequire(name); },
    process: { env: { HUB_RELEASE_DIR: candidate, HUB_NODE_BIN: node, CRM_MYSQL_PASSWORD: "sensitive-fixture" } },
    module: result,
  };
  vm.runInNewContext(ecosystem, context);
  assert.deepEqual(Array.from(result.exports.apps, item => item.name), ["hub-api", "voltronix-hub"]);
  for (const item of result.exports.apps) {
    assert.equal(item.cwd, candidate);
    assert.equal(item.interpreter, node);
    assert.equal(item.script, candidate + "/tools/run-hub.mjs");
    assert.equal(item.env.CRM_MYSQL_PASSWORD, undefined);
    assert.ok(!JSON.stringify(item).includes("sensitive-fixture"));
    assert.ok(item.out_file.startsWith(home + "/hub-deploy-logs/"));
  }
  assert.deepEqual(f.reads, []);
  context.process.env.HUB_RELEASE_DIR = "/var/www/other";
  assert.throws(() => vm.runInNewContext(ecosystem, context));
});

test("controller orders build, activation, health acceptance and persistence without broad cleanup", () => {
  const activation = script.indexOf("STAGE=activate");
  const build = script.indexOf("STAGE=build-and-test");
  assert.ok(build > 0 && activation > build);
  assert.ok(script.indexOf('helper commit "$CANDIDATE" "$COMMIT"') > activation);
  assert.match(script, /flock --nonblock 9/);
  assert.match(script, /git -C "\$REPO" archive --format=tar "\$COMMIT"/);
  assert.match(script, /merge-base --is-ancestor "\$REPAIR_COMMIT" "\$COMMIT"/);
  assert.match(script, /merge-base --is-ancestor "\$PREVIOUS_COMMIT" "\$COMMIT"/);
  assert.match(script, /HUB_RELEASE_DIR="\$PROCESS_RELEASE" "\$HUB_PM2_BIN" "\$@" 9>&-/);
  const commands = script.split("\n").filter(line => !line.trim().startsWith("#")).join("\n");
  assert.doesNotMatch(commands, /pm2 (?:restart|delete|reload) all|git (?:reset|clean|push)|rm -rf|mysql:operator|mysql:migrate|db:migrate/);
  assert.doesNotMatch(commands, /(?:source|\.) "\$CONFIG\/backend\.env"/);
  assert.match(script, /hub_pm2 start "\$ecosystem" --only hub-api[\s\S]*wait_api[\s\S]*hub_pm2 start "\$ecosystem" --only voltronix-hub/);
});

test("systemd timer persists two-minute checks and uses prepared paths with journal output", () => {
  const service = readFileSync(new URL("../deploy/ubuntu/hub-deploy.service", import.meta.url), "utf8");
  const timer = readFileSync(new URL("../deploy/ubuntu/hub-deploy.timer", import.meta.url), "utf8");
  const rotation = readFileSync(new URL("../deploy/ubuntu/hub-logrotate.conf", import.meta.url), "utf8");
  assert.match(service, /^User=rjpmadmin$/m);
  assert.match(service, /^Environment=HOME=\/home\/rjpmadmin$/m);
  assert.match(service, /^Environment=PM2_HOME=\/home\/rjpmadmin\/\.pm2$/m);
  assert.match(service, /^StandardOutput=journal$/m);
  assert.match(service, /^ConditionPathExists=\/home\/rjpmadmin\/hub-deploy-state\/accepted\.json$/m);
  assert.match(timer, /^OnCalendar=\*-\*-\* \*:0\/2:00$/m);
  assert.match(timer, /^Persistent=true$/m);
  assert.doesNotMatch(rotation, /\/\.pm2\/logs|\/\*\.log/);
  assert.match(rotation, /su rjpmadmin rjpmadmin/);
});

test("the user-manager alternative uses the actual host executables and the same accepted-state gates without changing service identity", () => {
  const unit = readFileSync(new URL("../deploy/ubuntu/hub-deploy-user.service", import.meta.url), "utf8");
  const timer = readFileSync(new URL("../deploy/ubuntu/hub-deploy.timer", import.meta.url), "utf8");
  assert.match(unit, /Install as \/home\/rjpmadmin\/\.config\/systemd\/user\/hub-deploy\.service\./);
  assert.doesNotMatch(unit, /^(?:User|Group|DynamicUser)=/m);
  for (const filename of ["hub-deploy-state/accepted.json", "hub-config/backend.env", "hub-config/frontend.env", "hub-deploy/hub-deploy.sh"]) {
    assert.ok(unit.includes(`ConditionPathExists=/home/rjpmadmin/${filename}`));
  }
  for (const directive of ["Type=oneshot", "WorkingDirectory=/home/rjpmadmin/voltronix-hub-deployment/source",
    "Environment=HUB_NODE_BIN=/usr/bin/node", "Environment=HUB_PM2_BIN=/usr/lib/node_modules/pm2/bin/pm2",
    "Environment=PM2_HOME=/home/rjpmadmin/.pm2", "ExecStart=/bin/bash /home/rjpmadmin/hub-deploy/hub-deploy.sh",
    "NoNewPrivileges=true", "PrivateTmp=true", "Nice=10", "UMask=0077", "StandardOutput=journal", "StandardError=journal"]) {
    assert.ok(unit.split(/\r?\n/).includes(directive), directive);
  }
  assert.match(timer, /^Unit=hub-deploy\.service$/m);
  assert.doesNotMatch(unit, /^EnvironmentFile=|CRM_MYSQL_|PASSWORD=/m);
});

test("Git attributes force LF for Linux deployment scripts and both systemd scopes", () => {
  const attributes = readFileSync(new URL("../.gitattributes", import.meta.url), "utf8");
  for (const pattern of ["/deploy/ubuntu/*.sh", "/deploy/ubuntu/*.service", "/deploy/ubuntu/*.timer", "/deploy/ubuntu/*.conf", "/.gitattributes"]) {
    assert.ok(attributes.split(/\r?\n/).includes(`${pattern} text eol=lf`));
  }
});

test("deployment shell parses with Bash", t => {
  const bash = ["/bin/bash", "C:/Program Files/Git/bin/bash.exe"].find(existsSync);
  if (!bash) { t.skip("Bash is unavailable; run bash -n on Ubuntu before installation."); return; }
  const result = spawnSync(bash, ["-n", fileURLToPath(scriptUrl)], { encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
});
