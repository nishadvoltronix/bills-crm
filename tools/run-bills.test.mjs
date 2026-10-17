import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { assertApiIdentity, assertBuildOutput, assertNoEnvironmentFiles, assertPortFree, validateProfile } from "./run-bills.mjs";

const common = { NODE_ENV: "production", APP_ORIGIN: "https://bills.voltronix.ae", CRM_API_INSTANCE_ID: "bills-crm",
  CRM_DATABASE_MODE: "disabled", CRM_MYSQL_NETWORK_DISABLED: "1", ZOHO_ENABLED: "false", NEXT_TELEMETRY_DISABLED: "1" };
const web = { ...common, CRM_WEB_HOST: "127.0.0.1", CRM_WEB_PORT: "3301", CRM_FRONTEND_BACKEND: "express", CRM_EXPRESS_ORIGIN: "http://127.0.0.1:3302" };
const api = { ...common, CRM_API_ENVIRONMENT: "production", CRM_API_HOST: "127.0.0.1", CRM_API_PORT: "3302" };
const identity = { service: "bills-crm-api", instanceId: "bills-crm", appOrigin: common.APP_ORIGIN };

test("production profiles require every setting and discard unrelated inherited values", () => {
  for (const [kind, environment] of [["web", web], ["api", api]]) {
    const config = validateProfile(kind, { ...environment, PATH: "test-path", UNRELATED_TOKEN: "not-forwarded" });
    assert.equal(config.environment.PATH, "test-path");
    assert.equal(config.environment.UNRELATED_TOKEN, undefined);
    for (const key of Object.keys(environment)) {
      const missing = { ...environment }; delete missing[key];
      assert.throws(() => validateProfile(kind, missing), undefined, `${kind} must require ${key}`);
    }
  }
});
test("database selectors and credentials never fall back to disabled or demo mode", () => {
  for (const key of ["CRM_RUNTIME_ENABLE", "CRM_RUNTIME_PROFILE", "CRM_RUNTIME_SOURCE", "CRM_MYSQL_PASSWORD", "DB_PASSWORD", "DATABASE_URL", "MYSQL_HOST", "ZOHO_REFRESH_TOKEN", "NEXT_PUBLIC_API_ORIGIN"]) {
    assert.throws(() => validateProfile("web", { ...web, [key]: "sensitive-fixture-value" }), error => !error.message.includes("sensitive-fixture-value"));
  }
  for (const mode of ["legacy", "native", "sqlite", "demo", "", "DISABLED"]) assert.throws(() => validateProfile("api", { ...api, CRM_DATABASE_MODE: mode }));
  assert.throws(() => validateProfile("api", { ...api, ZOHO_ENABLED: "true" }));
  assert.throws(() => validateProfile("api", { ...api, CRM_MYSQL_NETWORK_DISABLED: "0" }));
});
test("unsafe runtime injection and proxies are refused without echoing their values", () => {
  for (const key of ["NODE_OPTIONS", "NODE_TLS_REJECT_UNAUTHORIZED", "DEBUG", "HTTP_PROXY", "https_proxy", "ALL_PROXY", "NODE_USE_ENV_PROXY"]) {
    assert.throws(() => validateProfile("web", { ...web, [key]: "private-setting" }), error => error.message.includes(key) && !error.message.includes("private-setting"));
  }
});
test("HTTPS canonical origin, instance and explicit independent loopback ports are validated", () => {
  for (const origin of ["http://bills.voltronix.ae", "https://bills.voltronix.ae/", "https://bills.voltronix.ae:444", "https://127.0.0.1", "https://foo.localhost", "https://user:pass@bills.voltronix.ae"]) {
    assert.throws(() => validateProfile("web", { ...web, APP_ORIGIN: origin }));
  }
  for (const upstream of ["http://127.0.0.1:3301", "http://localhost:3302", "http://192.0.2.1:3302", "http://127.0.0.1:3302/path", "http://127.0.0.1", "https://127.0.0.1:3302"]) {
    assert.throws(() => validateProfile("web", { ...web, CRM_EXPRESS_ORIGIN: upstream }));
  }
  for (const invalid of ["0.0.0.0", "localhost", "192.0.2.1", "::"]) assert.throws(() => validateProfile("api", { ...api, CRM_API_HOST: invalid }));
  for (const invalid of ["0", "80", "65536", "3302x", " 3302", "03302"]) assert.throws(() => validateProfile("api", { ...api, CRM_API_PORT: invalid }));
  for (const invalid of ["", "UPPER", "space value", "a".repeat(65)]) assert.throws(() => validateProfile("api", { ...api, CRM_API_INSTANCE_ID: invalid }));
  assert.equal(validateProfile("web", { ...web, CRM_WEB_HOST: "::1", CRM_EXPRESS_ORIGIN: "http://[::1]:4402" }).apiOrigin, "http://[::1]:4402");
});
test("active dotenv files fail before release startup; templates alone are allowed", () => {
  const root = mkdtempSync(join(tmpdir(), "bills-config-test-"));
  try {
    mkdirSync(join(root, "server"));
    writeFileSync(join(root, ".env.example"), "# template");
    assert.doesNotThrow(() => assertNoEnvironmentFiles(root));
    for (const name of [".env", ".env.local", ".env.production", ".ENV.PRODUCTION"]) {
      const path = join(root, "server", name);
      writeFileSync(path, "# deliberately empty");
      assert.throws(() => assertNoEnvironmentFiles(root), /active .env/);
      rmSync(path);
    }
  } finally { rmSync(root, { recursive: true }); }
});
test("missing compiled release output is refused", () => {
  const root = mkdtempSync(join(tmpdir(), "bills-build-test-"));
  try { assert.throws(() => assertBuildOutput(root, "api"), /Missing required build output/); }
  finally { rmSync(root, { recursive: true }); }
});
test("occupied listener produces a useful error and leaves the existing service running", async () => {
  const server = createServer((_request, response) => response.end("existing-service"));
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const port = server.address().port;
    await assert.rejects(assertPortFree("127.0.0.1", port), new RegExp(`127.0.0.1:${port} is unavailable`));
    assert.equal(await (await fetch(`http://127.0.0.1:${port}`)).text(), "existing-service");
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
test("identity preflight is credential-free and accepts only the configured service", async () => {
  const profile = validateProfile("web", web);
  await assertApiIdentity(profile, async (url, options) => {
    assert.equal(url, `${web.CRM_EXPRESS_ORIGIN}/api/v1/health/identity`);
    assert.equal(options.method, "GET"); assert.equal(options.credentials, "omit");
    assert.equal(options.redirect, "error"); assert.equal(options.cache, "no-store");
    assert.deepEqual(options.headers, { accept: "application/json" }); assert.equal(options.body, undefined);
    return Response.json(identity);
  });
  for (const body of [{ ...identity, service: "other" }, { ...identity, instanceId: "other" }, { ...identity, appOrigin: "https://crm.voltronix.ae" }, { ...identity, extra: true }, null]) {
    await assert.rejects(assertApiIdentity(profile, async () => Response.json(body)), /identity check failed/);
  }
});
test("malformed, unavailable and oversized identity responses fail closed", async () => {
  const profile = validateProfile("web", web);
  for (const response of [new Response("unavailable", { status: 503 }), new Response(JSON.stringify(identity)),
    Response.json(identity, { headers: { "set-cookie": "unexpected=value" } }),
    new Response("{", { headers: { "content-type": "application/json" } }),
    new Response(" ".repeat(4097), { headers: { "content-type": "application/json" } })]) {
    await assert.rejects(assertApiIdentity(profile, async () => response), /identity check failed/);
  }
  await assert.rejects(assertApiIdentity(profile, async () => { throw new Error("private upstream detail"); }), error => !error.message.includes("private upstream detail"));
});
