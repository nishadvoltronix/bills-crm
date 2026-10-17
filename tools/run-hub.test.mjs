import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { chmodSync, linkSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { assertApiReady, assertBuildOutput, assertNoEnvironmentFiles, assertPortFree,
  main, parseEnvironment, readExternalEnvironment, validateProfile } from "./run-hub.mjs";

const common = { NODE_ENV: "production", APP_ORIGIN: "https://hub.voltronix.ae", CRM_API_INSTANCE_ID: "hub-crm",
  ZOHO_ENABLED: "false", NEXT_TELEMETRY_DISABLED: "1" };
const web = { ...common, CRM_WEB_HOST: "192.168.30.21", CRM_WEB_PORT: "3090",
  CRM_FRONTEND_BACKEND: "express", CRM_EXPRESS_ORIGIN: "http://127.0.0.1:3002" };
const api = { ...common, CRM_API_ENVIRONMENT: "production", CRM_API_HOST: "127.0.0.1", CRM_API_PORT: "3002",
  CRM_RUNTIME_ENABLE: "approved-production-mysql-crm-runtime", CRM_RUNTIME_SOURCE: "environment", CRM_MYSQL_HOST: "127.0.0.1",
  CRM_MYSQL_PORT: "3306", CRM_MYSQL_DATABASE: "voltronix_hub", CRM_MYSQL_USER: "hub_test_runtime", CRM_MYSQL_PASSWORD: "synthetic-fixture",
  CRM_MYSQL_SERVER_UUID: "12345678-1234-1234-1234-123456789abc", CRM_MYSQL_APPROVED: "true", CRM_MYSQL_APPROVAL_REFERENCE: "test review",
  CRM_MYSQL_PROVISIONING_REFERENCE: "test provision", CRM_MYSQL_ISSUER_COMPANY: "VOLTRONIX CONTRACTING LLC", CRM_MYSQL_ISSUER_SALESPERSON: "Test Issuer" };
const identity = { service: "bills-crm-api", instanceId: common.CRM_API_INSTANCE_ID, appOrigin: common.APP_ORIGIN };
const serialize = values => Object.entries(values).map(([key, value]) => `${key}='${value}'`).join("\n");
const fixture = () => mkdtempSync(join(homedir(), ".hub-launcher-test-"));

test("HUB profiles require every setting and isolate backend secrets from frontend/build processes", () => {
  for (const [kind, values] of [["web", web], ["api", api]]) {
    const profile = validateProfile(kind, values, { PATH: "test-path", CRM_MYSQL_PASSWORD: "inherited-private-value", UNRELATED_TOKEN: "private" });
    assert.equal(profile.environment.PATH, "test-path");
    assert.equal(profile.environment.UNRELATED_TOKEN, undefined);
    assert.equal(profile.environment.CRM_MYSQL_PASSWORD, kind === "api" ? api.CRM_MYSQL_PASSWORD : undefined);
    for (const key of Object.keys(values)) {
      const missing = { ...values }; delete missing[key];
      assert.throws(() => validateProfile(kind, missing), undefined, `${kind} must explicitly require ${key}`);
    }
  }
  for (const key of ["CRM_MYSQL_PASSWORD", "MYSQL_PASSWORD", "DB_PASSWORD", "DATABASE_URL", "NEXT_PUBLIC_API_URL", "CRM_RUNTIME_SOURCE", "NODE_OPTIONS"]) {
    assert.throws(() => validateProfile("web", { ...web, [key]: "private-value" }), error => !error.message.includes("private-value"));
  }
});

test("HUB configuration never falls back to Bills, disabled persistence, a JSON profile or demo credentials", () => {
  for (const [key, value] of [["APP_ORIGIN", "https://bills.voltronix.ae"], ["CRM_API_INSTANCE_ID", "bills-crm"],
    ["NODE_ENV", "development"], ["ZOHO_ENABLED", "true"], ["CRM_RUNTIME_ENABLE", "approved-local-mysql-crm-runtime"],
    ["CRM_RUNTIME_SOURCE", "profile"], ["CRM_DATABASE_MODE", "disabled"], ["CRM_MYSQL_NETWORK_DISABLED", "1"],
    ["CRM_RUNTIME_PROFILE", ".local-data/operators/mysql-crm-runtime.json"], ["CRM_MYSQL_APPROVED", "false"],
    ["CRM_MYSQL_DATABASE", "mysql"], ["CRM_MYSQL_DATABASE", "UPPERCASE"], ["CRM_MYSQL_DATABASE", "other_application"], ["CRM_MYSQL_USER", "root"],
    ["CRM_MYSQL_HOST", "192.168.30.20"], ["CRM_MYSQL_PORT", "3307"], ["CRM_MYSQL_SERVER_UUID", "not-a-uuid"]]) {
    assert.throws(() => validateProfile("api", { ...api, [key]: value }), undefined, key);
  }
});

test("the web permits the exact proxy-facing interface and refuses wildcard, arbitrary and mismatched listeners", () => {
  assert.equal(validateProfile("web", web).host, "192.168.30.21");
  assert.equal(validateProfile("web", { ...web, CRM_WEB_HOST: "127.0.0.1" }).host, "127.0.0.1");
  for (const host of ["0.0.0.0", "::", "::1", "localhost", "192.168.30.20", "192.168.30.22", "127.1"]) {
    assert.throws(() => validateProfile("web", { ...web, CRM_WEB_HOST: host }));
    assert.throws(() => validateProfile("api", { ...api, CRM_API_HOST: host }));
  }
  for (const origin of ["http://127.0.0.1:3302", "http://127.0.0.1:3002/", "http://localhost:3002", "http://192.168.30.21:3002", "http://127.0.0.1:3002/path"]) {
    assert.throws(() => validateProfile("web", { ...web, CRM_EXPRESS_ORIGIN: origin }));
  }
  for (const port of ["80", "3090x", "03090", "3001", "65536"]) assert.throws(() => validateProfile("web", { ...web, CRM_WEB_PORT: port }));
  for (const port of ["3002x", "03002", "3302"]) assert.throws(() => validateProfile("api", { ...api, CRM_API_PORT: port }));
});

test("debugging, runtime injection and network proxies are never inherited by a production child", () => {
  for (const key of ["NODE_OPTIONS", "NODE_DEBUG", "NODE_DEBUG_NATIVE", "NODE_TLS_REJECT_UNAUTHORIZED", "NODE_EXTRA_CA_CERTS", "DEBUG", "PWDEBUG",
    "HTTP_PROXY", "https_proxy", "ALL_PROXY", "NODE_USE_ENV_PROXY", "LD_PRELOAD", "LD_LIBRARY_PATH", "DYLD_INSERT_LIBRARIES"]) {
    assert.throws(() => validateProfile("api", api, { [key]: "sensitive-fixture" }), error => !error.message.includes("sensitive-fixture"));
  }
});

test("dotenv is strictly parsed as data with no duplicate keys, injected options or multiline values", () => {
  assert.deepEqual({ ...parseEnvironment("web", serialize(web)) }, web);
  const literal = "$(touch /should-never-exist) ${HOME} `command`";
  assert.equal(parseEnvironment("api", serialize({ ...api, CRM_MYSQL_PASSWORD: literal })).CRM_MYSQL_PASSWORD, literal);
  for (const source of [serialize(web) + "\nAPP_ORIGIN=https://other.invalid", "NODE_OPTIONS=--import=private", "export X=secret",
    "CRM_MYSQL_PASSWORD=private", "APP_ORIGIN='line\nline'", "APP_ORIGIN=\0", "APP_ORIGIN=" + "x".repeat(16_384), "APP_ORIGIN='unterminated"]) {
    assert.throws(() => parseEnvironment("web", source), error => !error.message.includes("secret") && !error.message.includes("private"));
  }
});

test("external environment loading refuses release-local files, aliases, hard links and malformed bytes", () => {
  const directory = fixture(), release = join(directory, "release"), file = join(directory, "backend.env");
  try {
    mkdirSync(release); writeFileSync(file, serialize(api), { mode: 0o600 });
    assert.deepEqual({ ...readExternalEnvironment("api", file, release) }, api);
    assert.throws(() => readExternalEnvironment("api", "backend.env", release), /external HUB/);
    const local = join(release, "backend.env"); writeFileSync(local, serialize(api), { mode: 0o600 });
    assert.throws(() => readExternalEnvironment("api", local, release), /external HUB/);
    const hardlink = join(directory, "backend-linked.env"); linkSync(file, hardlink);
    assert.throws(() => readExternalEnvironment("api", hardlink, release), /external HUB/);
    rmSync(hardlink);
    if (process.platform !== "win32") {
      const alias = join(directory, "backend-alias.env"); symlinkSync(file, alias);
      assert.throws(() => readExternalEnvironment("api", alias, release), /external HUB/);
      chmodSync(file, 0o640);
      assert.throws(() => readExternalEnvironment("api", file, release), /external HUB/);
      chmodSync(file, 0o600);
    }
    writeFileSync(file, Buffer.from([0xff]));
    assert.throws(() => readExternalEnvironment("api", file, release), /external HUB/);
  } finally { rmSync(directory, { recursive: true }); }
});

test("active dotenv files are refused before any runtime can auto-load them", () => {
  const root = fixture();
  try {
    mkdirSync(join(root, "server"));
    writeFileSync(join(root, ".env.example"), "# safe template");
    assert.doesNotThrow(() => assertNoEnvironmentFiles(root));
    for (const directory of [root, join(root, "server")]) {
      for (const name of [".env", ".env.local", ".env.production", ".ENV.PRODUCTION"]) {
        const file = join(directory, name); writeFileSync(file, "");
        assert.throws(() => assertNoEnvironmentFiles(root), /active .env/); rmSync(file);
      }
    }
  } finally { rmSync(root, { recursive: true }); }
});

test("activation requires all three builds plus a matching HUB build receipt", () => {
  const root = fixture(), profile = validateProfile("web", web);
  try {
    const files = ["shared/contracts/dist/index.js", "server/dist/cli.js", "server/dist/runtime/configuration.js", ".next/BUILD_ID", ".next/hub-build.json"];
    for (const name of files) {
      assert.throws(() => assertBuildOutput(root, profile), /Missing required HUB build/);
      const path = join(root, name); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, "built");
    }
    const marker = join(root, ".next/hub-build.json");
    assert.throws(() => assertBuildOutput(root, profile), /receipt/);
    const receipt = { version: 1, appOrigin: common.APP_ORIGIN, instanceId: common.CRM_API_INSTANCE_ID, apiOrigin: web.CRM_EXPRESS_ORIGIN };
    writeFileSync(marker, JSON.stringify(receipt));
    assert.doesNotThrow(() => assertBuildOutput(root, profile));
    assert.doesNotThrow(() => assertBuildOutput(root, validateProfile("api", api)));
    writeFileSync(marker, JSON.stringify({ ...receipt, instanceId: "bills-crm" }));
    assert.throws(() => assertBuildOutput(root, profile), /receipt/);
  } finally { rmSync(root, { recursive: true }); }
});

test("occupied listener is preserved and no owner is stopped", async () => {
  const server = createServer((_request, response) => response.end("existing-service"));
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const port = server.address().port;
    await assert.rejects(assertPortFree("127.0.0.1", port), /unavailable/);
    assert.equal(await (await fetch(`http://127.0.0.1:${port}`)).text(), "existing-service");
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});

test("web activation verifies HUB identity then live MySQL readiness without credentials", async () => {
  const paths = [];
  await assertApiReady(validateProfile("web", web), async (url, options) => {
    paths.push(url);
    assert.equal(options.method, "GET"); assert.equal(options.credentials, "omit"); assert.equal(options.redirect, "error");
    assert.equal(options.cache, "no-store"); assert.deepEqual(options.headers, { accept: "application/json" }); assert.equal(options.body, undefined);
    return Response.json(url.endsWith("/identity") ? identity : { status: "ready" });
  });
  assert.deepEqual(paths, [web.CRM_EXPRESS_ORIGIN + "/api/v1/health/identity", web.CRM_EXPRESS_ORIGIN + "/api/v1/health/ready"]);
});

test("wrong identity stops before readiness; unavailable, malformed and cookie-bearing readiness fails closed", async () => {
  const profile = validateProfile("web", web);
  for (const value of [null, { ...identity, service: "hub-crm-api" }, { ...identity, instanceId: "bills-crm" },
    { ...identity, appOrigin: "https://bills.voltronix.ae" }, { ...identity, extra: true }]) {
    let calls = 0;
    await assert.rejects(assertApiReady(profile, async () => { calls++; return Response.json(value); }), /identity/);
    assert.equal(calls, 1);
  }
  for (const response of [Response.json({ status: "unavailable" }, { status: 503 }), Response.json({ status: "ready", extra: true }),
    Response.json({ status: "ready" }, { headers: { "set-cookie": "unwanted=value" } }), new Response('{"status":"ready"}'),
    new Response("{", { headers: { "content-type": "application/json" } }),
    new Response(" ".repeat(4_097), { headers: { "content-type": "application/json" } })]) {
    await assert.rejects(assertApiReady(profile, async url => url.endsWith("/identity") ? Response.json(identity) : response), /readiness/);
  }
  await assert.rejects(assertApiReady(profile, async () => { throw new Error("private upstream detail"); }), error => !error.message.includes("private upstream detail"));
});

test("the checked-in frontend template has no database settings and backend blanks cannot activate a runtime", () => {
  const frontend = parseEnvironment("web", readFileSync(new URL("../deploy/ubuntu/hub-web.env.example", import.meta.url), "utf8"));
  const backend = parseEnvironment("api", readFileSync(new URL("../deploy/ubuntu/hub-api.env.example", import.meta.url), "utf8"));
  assert.deepEqual({ ...frontend }, web);
  assert.throws(() => validateProfile("api", backend), /explicit valid CRM_MYSQL_USER/);
  for (const key of Object.keys(frontend)) assert.doesNotMatch(key, /PASSWORD|SECRET|TOKEN|MYSQL|DATABASE|RUNTIME/);
});

test("the executable requires an explicit external environment argument", async () => {
  for (const args of [[], ["web"], ["api", "--env-file"], ["start", "--env-file", "/etc/backend.env"], ["api", "/etc/backend.env", "extra"]]) {
    await assert.rejects(main(args), /Usage:/);
  }
});

test("PM2 fork-container ESM startup executes every build stage with only frontend configuration", async () => {
  const directory = fixture(), root = join(directory, "release"), file = join(directory, "frontend.env");
  try {
    mkdirSync(root); writeFileSync(file, serialize(web), { mode: 0o600 });
    writeFileSync(join(root, "package.json"), '{"type":"module"}');
    const recorder = `import { mkdirSync, appendFileSync, writeFileSync } from 'node:fs';
      import { dirname } from 'node:path';
      if (process.env.CRM_MYSQL_PASSWORD || process.env.UNRELATED_TOKEN || process.env.CRM_RUNTIME_ENABLE) process.exit(91);
      if (process.env.CRM_FRONTEND_BACKEND !== 'express' || process.env.APP_ORIGIN !== 'https://hub.voltronix.ae') process.exit(92);
      const stage = process.argv[2] === '-p' ? process.argv[3] : process.argv[2];
      appendFileSync('build-stages.txt', stage + '\\n');
      const output = (name, value='compiled') => { mkdirSync(dirname(name), { recursive:true }); writeFileSync(name, value); };
      if (stage === 'shared/contracts/tsconfig.json') output('shared/contracts/dist/index.js');
      else if (stage === 'tsconfig.server.build.json') { output('server/dist/cli.js'); output('server/dist/runtime/configuration.js'); }
      else if (stage === 'build') output('.next/BUILD_ID');
      else process.exit(93);`;
    const typescript = join(root, "node_modules/typescript/bin/tsc"), next = join(root, "node_modules/next/dist/bin/next");
    for (const path of [typescript, next]) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, recorder); }
    const operatingSystem = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(?:PATH|SYSTEMROOT|WINDIR|HOME|USERPROFILE|TEMP|TMP|TMPDIR)$/i.test(key)));
    const inherited = { ...operatingSystem, CRM_MYSQL_PASSWORD: "private-inherited-secret", UNRELATED_TOKEN: "private-inherited-token" };
    const launcher = join(root, "tools/run-hub.mjs"), container = join(directory, "ProcessContainerFork.cjs");
    mkdirSync(dirname(launcher)); writeFileSync(launcher, readFileSync(new URL("./run-hub.mjs", import.meta.url)));
    // Actual PM2 ForkMode.js spawns node ProcessContainerFork.js followed by app
    // args. The container dynamically imports pm_exec_path and leaves argv alone.
    writeFileSync(container, "import(require('node:url').pathToFileURL(process.env.pm_exec_path));\n");
    const started = spawnSync(process.execPath, [container, "build", "--env-file", file], {
      cwd: root, env: { ...inherited, pm_exec_path: launcher, pm_cwd: root }, encoding: "utf8", windowsHide: true, timeout: 15_000,
    });
    assert.equal(started.error, undefined); assert.equal(started.status, 0, started.stderr);
    assert.equal(readFileSync(join(root, "build-stages.txt"), "utf8"), "shared/contracts/tsconfig.json\ntsconfig.server.build.json\nbuild\n");
    assert.doesNotThrow(() => assertBuildOutput(root, validateProfile("web", web)));
    // A failed rebuild removes the old success marker and never reaches later stages.
    writeFileSync(typescript, "process.exit(7);");
    await assert.rejects(main(["build", "--env-file", file], inherited, root), /child process failed/);
    assert.throws(() => assertBuildOutput(root, validateProfile("web", web)), /hub-build.json/);
    assert.equal(readFileSync(join(root, "build-stages.txt"), "utf8").split("\n").filter(Boolean).length, 3);
  } finally { rmSync(directory, { recursive: true }); }
});

test("PM2 imported API entrypoint preserves role/env-file args; unrelated imports stay inert", () => {
  const directory = fixture(), root = join(directory, "release"), launcher = join(root, "tools/run-hub.mjs");
  try {
    mkdirSync(dirname(launcher), { recursive: true });
    writeFileSync(launcher, readFileSync(new URL("./run-hub.mjs", import.meta.url)));
    const container = join(directory, "ProcessContainerFork.cjs"), frontendFile = join(directory, "frontend-not-backend.env");
    writeFileSync(frontendFile, serialize(web), { mode: 0o600 });
    // A real child process supplies argv; the harness does not invoke main or
    // reproduce its entrypoint predicate. This models the deployed PM2 ESM import.
    writeFileSync(container, "import(require('node:url').pathToFileURL(process.env.pm_exec_path));\n");
    const os = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(?:PATH|SYSTEMROOT|WINDIR|HOME|USERPROFILE|TEMP|TMP|TMPDIR)$/i.test(key)));
    const result = spawnSync(process.execPath, [container, "api", "--env-file", frontendFile], {
      cwd: root, env: { ...os, pm_exec_path: launcher, pm_cwd: root }, encoding: "utf8", windowsHide: true, timeout: 10_000,
    });
    assert.equal(result.error, undefined); assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /Cannot load the external HUB environment file/);
    assert.doesNotMatch(result.stderr, /Usage:/); // api and --env-file reached main intact.
    const importer = join(directory, "other-application.cjs");
    writeFileSync(importer, "import(require('node:url').pathToFileURL(process.env.HUB_TEST_IMPORT));\n");
    const imported = spawnSync(process.execPath, [importer, "api", "--env-file", frontendFile], {
      cwd: root, env: { ...os, pm_exec_path: importer, HUB_TEST_IMPORT: launcher }, encoding: "utf8", windowsHide: true, timeout: 10_000,
    });
    assert.equal(imported.error, undefined); assert.equal(imported.status, 0); assert.equal(imported.stderr, "");
  } finally { rmSync(directory, { recursive: true }); }
});
