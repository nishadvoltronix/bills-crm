import { spawn } from "node:child_process";
import { existsSync, lstatSync, readdirSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const commonKeys = ["NODE_ENV", "APP_ORIGIN", "CRM_API_INSTANCE_ID", "CRM_DATABASE_MODE",
  "CRM_MYSQL_NETWORK_DISABLED", "ZOHO_ENABLED", "NEXT_TELEMETRY_DISABLED"];
const webKeys = ["CRM_WEB_HOST", "CRM_WEB_PORT", "CRM_FRONTEND_BACKEND", "CRM_EXPRESS_ORIGIN"];
const apiKeys = ["CRM_API_ENVIRONMENT", "CRM_API_HOST", "CRM_API_PORT"];
const allowedKeys = new Set([...commonKeys, ...webKeys, ...apiKeys]);
const operatingSystemKeys = new Set(["PATH", "SYSTEMROOT", "WINDIR", "COMSPEC", "PATHEXT",
  "TEMP", "TMP", "TMPDIR", "HOME", "USERPROFILE", "LANG", "LC_ALL", "TZ"]);
function fail(message) { throw new Error(message); }
function port(value, key) {
  if (!/^[1-9][0-9]{3,4}$/.test(value ?? "") || Number(value) < 1024 || Number(value) > 65535) {
    fail(`${key} must be an explicit port from 1024 to 65535.`);
  }
  return Number(value);
}
function host(value, key) {
  if (value !== "127.0.0.1" && value !== "::1") fail(`${key} must be 127.0.0.1 or ::1.`);
  return value;
}
function productionOrigin(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.origin === value && !url.port
      && url.hostname.includes(".") && url.hostname.length <= 253
      && !/^[0-9.]+$/.test(url.hostname) && !url.hostname.endsWith(".localhost")
      && url.hostname.split(".").every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label));
  } catch { return false; }
}

/** No profiles, dotenv, demo credentials, inherited integration settings or defaults. */
export function validateProfile(kind, environment) {
  if (kind !== "web" && kind !== "api") fail("Select the web or api profile.");
  for (const [key, value] of Object.entries(environment)) {
    if (value === undefined || value === "") continue;
    if ((!allowedKeys.has(key) && /^(?:CRM_|ZOHO_|DATABASE_|MYSQL_|DB_|NEXT_PUBLIC_)/i.test(key))
      || /^(?:NODE_OPTIONS|NODE_TLS_REJECT_UNAUTHORIZED|DEBUG|HTTP_PROXY|HTTPS_PROXY|ALL_PROXY|NODE_USE_ENV_PROXY)$/i.test(key)) {
      fail(`Unsupported environment setting: ${key}. Remove it from the Bills process environment.`);
    }
  }
  for (const [key, expected] of Object.entries({ NODE_ENV: "production", CRM_DATABASE_MODE: "disabled",
    CRM_MYSQL_NETWORK_DISABLED: "1", ZOHO_ENABLED: "false", NEXT_TELEMETRY_DISABLED: "1" })) {
    if (environment[key] !== expected) fail(`${key} must explicitly equal ${expected}. Database activation is unavailable.`);
  }
  if (!productionOrigin(environment.APP_ORIGIN)) fail("APP_ORIGIN must be a canonical public HTTPS origin without a port or path.");
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(environment.CRM_API_INSTANCE_ID ?? "")) fail("CRM_API_INSTANCE_ID must be a nonempty lowercase instance slug.");
  const profile = { kind, appOrigin: environment.APP_ORIGIN, instanceId: environment.CRM_API_INSTANCE_ID };
  if (kind === "web") {
    profile.host = host(environment.CRM_WEB_HOST, "CRM_WEB_HOST");
    profile.port = port(environment.CRM_WEB_PORT, "CRM_WEB_PORT");
    if (environment.CRM_FRONTEND_BACKEND !== "express") fail("CRM_FRONTEND_BACKEND must explicitly equal express.");
    try {
      const url = new URL(environment.CRM_EXPRESS_ORIGIN);
      if (url.protocol !== "http:" || url.origin !== environment.CRM_EXPRESS_ORIGIN
        || !["127.0.0.1", "[::1]"].includes(url.hostname) || port(url.port, "CRM_EXPRESS_ORIGIN port") === profile.port) throw new Error();
      profile.apiOrigin = url.origin;
    } catch { fail("CRM_EXPRESS_ORIGIN must be an explicit loopback HTTP origin on a different port from the web listener."); }
  } else {
    if (environment.CRM_API_ENVIRONMENT !== "production") fail("CRM_API_ENVIRONMENT must explicitly equal production.");
    profile.host = host(environment.CRM_API_HOST, "CRM_API_HOST");
    profile.port = port(environment.CRM_API_PORT, "CRM_API_PORT");
  }
  const keys = new Set([...commonKeys, ...(kind === "web" ? webKeys : apiKeys)]);
  profile.environment = Object.fromEntries(Object.entries(environment).filter(([key, value]) => value !== undefined
    && (keys.has(key) || operatingSystemKeys.has(key.toUpperCase()))));
  return Object.freeze(profile);
}

/** Next auto-loads .env at build/start; operator settings must stay outside source. */
export function assertNoEnvironmentFiles(root) {
  for (const directory of [root, join(root, "server")]) {
    if (!existsSync(directory)) continue;
    for (const name of readdirSync(directory)) {
      if (name.toLowerCase().startsWith(".env") && name !== ".env.example") fail("Remove active .env files from this release; use the separate service environment files.");
    }
  }
}
export function assertBuildOutput(root, kind) {
  const required = ["shared/contracts/dist/index.js", kind === "api" ? "server/dist/server.js" : ".next/BUILD_ID"];
  for (const relative of required) {
    const path = join(root, relative);
    if (!existsSync(path) || !lstatSync(path).isFile() || lstatSync(path).isSymbolicLink()) {
      fail(`Missing required build output: ${relative}. Build this release with the Bills web environment first.`);
    }
  }
}
export async function assertPortFree(bindHost, bindPort) {
  await new Promise((resolvePromise, reject) => {
    const probe = createServer();
    probe.once("error", () => reject(new Error(`Bills listener ${bindHost}:${bindPort} is unavailable. Check the port and bind address; no existing process was stopped.`)));
    probe.listen({ host: bindHost, port: bindPort, exclusive: true }, () => probe.close(error => error ? reject(new Error("Bills port probe failed.")) : resolvePromise()));
  });
}

export async function assertApiIdentity(profile, fetcher = fetch) {
  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), 2_000);
  let reader;
  try {
    const response = await fetcher(`${profile.apiOrigin}/api/v1/health/identity`, {
      method: "GET", credentials: "omit", cache: "no-store", redirect: "error", signal: abort.signal,
      headers: { accept: "application/json" },
    });
    if (response.status !== 200 || response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json"
      || response.headers.has("set-cookie") || !response.body) throw new Error();
    reader = response.body.getReader();
    let size = 0;
    const chunks = [];
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > 4_096) throw new Error();
      chunks.push(Buffer.from(part.value));
    }
    const identity = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (identity?.service !== "bills-crm-api" || identity?.instanceId !== profile.instanceId || identity?.appOrigin !== profile.appOrigin
      || Object.keys(identity).length !== 3) throw new Error();
  } catch { fail("Bills API identity check failed. Verify the dedicated API service, origin and CRM_API_INSTANCE_ID before starting the web service."); }
  finally { clearTimeout(timeout); abort.abort(); if (reader) { await reader.cancel().catch(() => {}); reader.releaseLock(); } }
}

async function runNode(root, environment, args, gracefulStop = false) {
  await new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, args, { cwd: root, env: environment, stdio: "inherit", windowsHide: true });
    let stopping = false;
    const stop = () => {
      if (stopping) return;
      stopping = true;
      if (process.platform === "win32" && child.pid) {
        // This PID belongs to this invocation; never discover or stop other listeners.
        const stopTree = spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
        stopTree.once("error", () => child.kill("SIGTERM"));
      } else child.kill("SIGTERM");
    };
    process.once("SIGINT", stop); process.once("SIGTERM", stop);
    const cleanup = () => { process.off("SIGINT", stop); process.off("SIGTERM", stop); };
    child.once("error", () => { cleanup(); reject(new Error("Bills child process could not start.")); });
    child.once("exit", code => {
      cleanup();
      if (stopping && !gracefulStop) reject(new Error("Bills build was interrupted; later build stages were not run. Rebuild this release before startup."));
      else if (code === 0 || (stopping && gracefulStop)) resolvePromise();
      else reject(new Error(`Bills child process failed (exit ${code ?? "signal"}); check configuration and listener availability.`));
    });
  });
}

export async function main(command, environment = process.env, root = projectRoot) {
  if (!/^(?:build|web|api|check-web|check-api)$/.test(command ?? "")) fail("Usage: node tools/run-bills.mjs build|web|api|check-web|check-api");
  if (Number(process.versions.node.split(".")[0]) !== 24) fail("Bills requires its own Node.js 24 runtime; do not change another application's Node version.");
  const kind = command.endsWith("api") ? "api" : "web";
  const profile = validateProfile(kind, environment);
  assertNoEnvironmentFiles(root);
  if (command === "build") {
    for (const args of [["node_modules/typescript/bin/tsc", "-p", "shared/contracts/tsconfig.json"],
      ["node_modules/typescript/bin/tsc", "-p", "tsconfig.server.build.json"], ["node_modules/next/dist/bin/next", "build"]]) {
      await runNode(root, profile.environment, args);
    }
    return;
  }
  assertBuildOutput(root, kind);
  await assertPortFree(profile.host, profile.port);
  if (command.startsWith("check-")) {
    process.stdout.write(`Bills ${kind} configuration, build output and listener availability passed; database remains disabled.\n`);
    return;
  }
  if (kind === "web") {
    await assertApiIdentity(profile);
    await runNode(root, profile.environment, ["node_modules/next/dist/bin/next", "start", "--hostname", profile.host, "--port", String(profile.port)], true);
    return;
  }
  // Deliberately bypasses the native MySQL CLI; no database, auth or CRM adapter is injected.
  const { startServer } = await import(pathToFileURL(join(root, "server/dist/server.js")).href);
  const api = await startServer({ environment: "production", host: profile.host, port: profile.port,
    appOrigin: profile.appOrigin, instanceId: profile.instanceId });
  process.stdout.write(`Bills API listening on ${profile.host}:${profile.port}; database disabled, readiness and authentication unavailable.\n`);
  const stop = () => { void api.stop().catch(() => { process.exitCode = 1; }); };
  process.once("SIGINT", stop); process.once("SIGTERM", stop);
  api.server.once("close", () => { process.off("SIGINT", stop); process.off("SIGTERM", stop); if (api.failed) process.exitCode = 1; });
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main(process.argv.length === 3 ? process.argv[2] : undefined).catch(error => {
    process.stderr.write(`${error instanceof Error ? error.message : "Bills startup failed."}\n`);
    process.exitCode = 1;
  });
}
