import { spawn } from "node:child_process";
import { closeSync, constants, existsSync, fstatSync, lstatSync, openSync, readFileSync, readSync,
  readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseEnv } from "node:util";

export const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const appOrigin = "https://hub.voltronix.ae";
const instanceId = "hub-crm";
const apiOrigin = "http://127.0.0.1:3002";
// Keep the shared API/bridge protocol identifier. The instance ID isolates HUB.
const apiService = "bills-crm-api";
const commonKeys = ["NODE_ENV", "APP_ORIGIN", "CRM_API_INSTANCE_ID", "ZOHO_ENABLED", "NEXT_TELEMETRY_DISABLED"];
const webKeys = [...commonKeys, "CRM_WEB_HOST", "CRM_WEB_PORT", "CRM_FRONTEND_BACKEND", "CRM_EXPRESS_ORIGIN"];
const apiKeys = [...commonKeys, "CRM_API_ENVIRONMENT", "CRM_API_HOST", "CRM_API_PORT", "CRM_RUNTIME_ENABLE", "CRM_RUNTIME_SOURCE",
  "CRM_MYSQL_HOST", "CRM_MYSQL_PORT", "CRM_MYSQL_DATABASE", "CRM_MYSQL_USER", "CRM_MYSQL_PASSWORD", "CRM_MYSQL_SERVER_UUID",
  "CRM_MYSQL_APPROVED", "CRM_MYSQL_APPROVAL_REFERENCE", "CRM_MYSQL_PROVISIONING_REFERENCE", "CRM_MYSQL_ISSUER_COMPANY", "CRM_MYSQL_ISSUER_SALESPERSON"];
const osKeys = new Set(["PATH", "SYSTEMROOT", "WINDIR", "COMSPEC", "PATHEXT", "TEMP", "TMP", "TMPDIR", "HOME", "USERPROFILE", "LANG", "LC_ALL", "TZ"]);
const dangerousKeys = /^(?:NODE_OPTIONS|NODE_DEBUG|NODE_DEBUG_NATIVE|NODE_TLS_REJECT_UNAUTHORIZED|NODE_EXTRA_CA_CERTS|DEBUG|PWDEBUG|HTTP_PROXY|HTTPS_PROXY|ALL_PROXY|NODE_USE_ENV_PROXY|LD_PRELOAD|LD_LIBRARY_PATH|DYLD_.+)$/i;
const maximumBytes = 16_384;
const receiptName = ".next/hub-build.json";
function fail(message) { throw new Error(message); }
const samePath = (a, b) => process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
function within(root, target) {
  const remainder = relative(root, target);
  return !remainder || (!isAbsolute(remainder) && remainder !== ".." && !remainder.startsWith(`..${sep}`));
}
function keysFor(kind) {
  if (kind !== "web" && kind !== "api") fail("Select the HUB web or api profile.");
  return new Set(kind === "web" ? webKeys : apiKeys);
}

/** Parse data, never execute it. Duplicate/unknown keys and multiline values fail closed. */
export function parseEnvironment(kind, source) {
  try {
    const supported = keysFor(kind), selected = new Set();
    if (typeof source !== "string" || Buffer.byteLength(source, "utf8") > maximumBytes || source.includes("\0")) throw new Error();
    const text = source.replace(/^\uFEFF/, "");
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim() || /^\s*#/.test(line)) continue;
      const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(?:'[^'\r\n]*'|"[^"\r\n]*"|[^#'"\r\n]*)(?:\s*#.*)?$/.exec(line);
      const key = match?.[1];
      if (!key || !supported.has(key) || selected.has(key)) throw new Error();
      selected.add(key);
    }
    const parsed = parseEnv(text);
    if (Object.keys(parsed).length !== selected.size) throw new Error();
    for (const [key, value] of Object.entries(parsed)) {
      if (!selected.has(key) || /[\r\n\0]/.test(value)) throw new Error();
    }
    return Object.freeze(parsed);
  } catch { fail("Invalid HUB environment file: use only the selected template's keys, one assignment per line, with no duplicates or multiline values."); }
}

/** Backend secrets stay outside the release. Check ordinary files and read the opened inode. */
export function readEnvironmentFile(kind, filename, root = projectRoot) {
  let descriptor;
  try {
    keysFor(kind);
    if (typeof filename !== "string" || !isAbsolute(filename)) throw new Error();
    const path = resolve(filename), release = realpathSync(root);
    if (within(release, path) || !samePath(realpathSync(path), path)) throw new Error();
    let cursor = path;
    while (true) {
      const stat = lstatSync(cursor);
      if (stat.isSymbolicLink() || !samePath(realpathSync(cursor), cursor)) throw new Error();
      if (process.platform !== "win32") {
        const owner = stat.uid === 0 || stat.uid === process.getuid?.();
        if (!owner || (stat.mode & (cursor === path && kind === "api" ? 0o077 : 0o022)) !== 0) throw new Error();
      }
      const parent = dirname(cursor);
      if (samePath(cursor, parent)) break;
      cursor = parent;
    }
    const before = lstatSync(path);
    if (!before.isFile() || before.nlink !== 1 || before.size > maximumBytes) throw new Error();
    descriptor = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const opened = fstatSync(descriptor);
    if (!opened.isFile() || opened.nlink !== 1 || opened.dev !== before.dev || opened.ino !== before.ino
      || opened.size !== before.size || opened.mtimeMs !== before.mtimeMs || opened.ctimeMs !== before.ctimeMs) throw new Error();
    const buffer = Buffer.alloc(maximumBytes + 1);
    let used = 0;
    while (used < buffer.length) {
      const count = readSync(descriptor, buffer, used, buffer.length - used, null);
      if (!count) break;
      used += count;
    }
    for (const after of [fstatSync(descriptor), lstatSync(path)]) {
      if (!after.isFile() || after.isSymbolicLink() || after.dev !== opened.dev || after.ino !== opened.ino || after.nlink !== 1
        || after.size !== opened.size || after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs
        || after.mode !== opened.mode || after.uid !== opened.uid) throw new Error();
    }
    if (used !== opened.size || used > maximumBytes) throw new Error();
    return parseEnvironment(kind, new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, used)));
  } catch { fail("Cannot load the external HUB environment file. Use an absolute path outside the release, an ordinary unlinked file and protected parent directories; backend permissions must be 0600 or 0400 with root/service ownership."); }
  finally { if (descriptor !== undefined) closeSync(descriptor); }
}

// Shared by the explicit offline administrator bootstrap executable.
export const readExternalEnvironment = readEnvironmentFile;

/** Only this role's explicit file and a small OS allowlist reach its child process. */
export function validateProfile(kind, values, inherited = {}) {
  const allowed = keysFor(kind);
  if (Object.keys(values).some(key => !allowed.has(key))) fail("Unsupported HUB environment key for this process.");
  for (const [key, value] of Object.entries(inherited)) {
    if (value && dangerousKeys.test(key)) fail("Remove runtime injection, debugging and proxy settings from the HUB launcher environment.");
  }
  for (const key of allowed) {
    if (typeof values[key] !== "string" || !values[key].trim() || /[\r\n\0]/.test(values[key])
      || Buffer.byteLength(values[key], "utf8") > 4_096) fail(`HUB requires an explicit valid ${key}.`);
  }
  for (const [key, expected] of Object.entries({ NODE_ENV: "production", APP_ORIGIN: appOrigin, CRM_API_INSTANCE_ID: instanceId,
    ZOHO_ENABLED: "false", NEXT_TELEMETRY_DISABLED: "1" })) {
    if (values[key] !== expected) fail(`HUB ${key} must explicitly equal ${expected}.`);
  }
  const profile = { kind, appOrigin, instanceId, apiOrigin };
  if (kind === "web") {
    if (!["127.0.0.1", "192.168.30.21"].includes(values.CRM_WEB_HOST)) fail("HUB CRM_WEB_HOST must be 127.0.0.1 or the dedicated 192.168.30.21 interface.");
    if (values.CRM_WEB_PORT !== "3090" || values.CRM_FRONTEND_BACKEND !== "express" || values.CRM_EXPRESS_ORIGIN !== apiOrigin) {
      fail("HUB web requires port 3090 and the explicit Express bridge to http://127.0.0.1:3002.");
    }
    profile.host = values.CRM_WEB_HOST; profile.port = 3090;
  } else {
    if (values.CRM_API_ENVIRONMENT !== "production" || values.CRM_API_HOST !== "127.0.0.1" || values.CRM_API_PORT !== "3002") {
      fail("HUB API requires production on 127.0.0.1:3002.");
    }
    if (values.CRM_RUNTIME_ENABLE !== "approved-production-mysql-crm-runtime" || values.CRM_RUNTIME_SOURCE !== "environment"
      || values.CRM_MYSQL_APPROVED !== "true") fail("HUB requires its explicitly approved production MySQL runtime; no disabled or demo fallback is available.");
    if (values.CRM_MYSQL_HOST !== "127.0.0.1" || !["3306", "3308"].includes(values.CRM_MYSQL_PORT)
      || values.CRM_MYSQL_DATABASE !== "voltronix_hub"
      || !/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,31}$/.test(values.CRM_MYSQL_USER)
      || /^(?:root|mysql\.)/i.test(values.CRM_MYSQL_USER)
      || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(values.CRM_MYSQL_SERVER_UUID)) {
      fail("HUB requires a dedicated valid local MySQL target and runtime identity.");
    }
    profile.host = "127.0.0.1"; profile.port = 3002;
  }
  const os = Object.fromEntries(Object.entries(inherited).filter(([key, value]) => value !== undefined && osKeys.has(key.toUpperCase())));
  profile.environment = Object.freeze({ ...os, ...values });
  return Object.freeze(profile);
}

/** Next auto-loads .env files; all active configuration must remain external. */
export function assertNoEnvironmentFiles(root) {
  for (const directory of [root, join(root, "server")]) {
    if (!existsSync(directory)) continue;
    for (const name of readdirSync(directory)) {
      if (name.toLowerCase().startsWith(".env") && name !== ".env.example") fail("Remove active .env files from this HUB release; use the separate external environment files.");
    }
  }
}

function receipt(profile) {
  return { version: 1, appOrigin: profile.appOrigin, instanceId: profile.instanceId, apiOrigin: profile.apiOrigin };
}
export function assertBuildOutput(root, profile) {
  for (const name of ["shared/contracts/dist/index.js", "server/dist/cli.js", "server/dist/runtime/configuration.js", ".next/BUILD_ID", receiptName]) {
    const path = join(root, name);
    if (!existsSync(path) || !lstatSync(path).isFile() || lstatSync(path).isSymbolicLink()) fail(`Missing required HUB build output: ${name}. Run hub:build first.`);
  }
  try {
    const path = join(root, receiptName);
    if (lstatSync(path).size > 1_024 || JSON.stringify(JSON.parse(readFileSync(path, "utf8"))) !== JSON.stringify(receipt(profile))) throw new Error();
  } catch { fail("The HUB build receipt does not match this release profile. Run hub:build before activation."); }
}

export async function assertPortFree(host, port) {
  await new Promise((resolvePromise, reject) => {
    const probe = createServer();
    probe.once("error", () => reject(new Error(`HUB listener ${host}:${port} is unavailable; no existing process was stopped.`)));
    probe.listen({ host, port, exclusive: true }, () => probe.close(error => error ? reject(new Error("HUB port probe failed.")) : resolvePromise()));
  });
}

async function probeJson(url, fetcher) {
  const abort = new AbortController(), timeout = setTimeout(() => abort.abort(), 6_000);
  let reader;
  try {
    const response = await fetcher(url, { method: "GET", credentials: "omit", cache: "no-store", redirect: "error", signal: abort.signal,
      headers: { accept: "application/json" } });
    if (response.status !== 200 || response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json"
      || response.headers.has("set-cookie") || !response.body) throw new Error();
    reader = response.body.getReader();
    const chunks = []; let size = 0;
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > 4_096) throw new Error();
      chunks.push(Buffer.from(part.value));
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } finally { clearTimeout(timeout); abort.abort(); if (reader) { await reader.cancel().catch(() => {}); reader.releaseLock(); } }
}

/** Both gates pass before Next binds; no cookies, credentials, redirects or forwarded headers. */
export async function assertApiReady(profile, fetcher = fetch) {
  try {
    const identity = await probeJson(`${profile.apiOrigin}/api/v1/health/identity`, fetcher);
    if (identity?.service !== apiService || identity?.instanceId !== profile.instanceId || identity?.appOrigin !== profile.appOrigin
      || Object.keys(identity).length !== 3) throw new Error();
  } catch { fail("HUB API identity check failed. Verify its dedicated instance and origin before web activation."); }
  try {
    const ready = await probeJson(`${profile.apiOrigin}/api/v1/health/ready`, fetcher);
    if (ready?.status !== "ready" || Object.keys(ready).length !== 1) throw new Error();
  } catch { fail("HUB API readiness check failed. Web activation requires the real MySQL runtime to be ready."); }
}

async function runNode(root, environment, args, service = false) {
  await new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, args, { cwd: root, env: environment, stdio: "inherit", windowsHide: true });
    let stopping = false;
    const stop = () => {
      if (stopping) return;
      stopping = true;
      if (process.platform === "win32" && child.pid) {
        const tree = spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
        tree.once("error", () => child.kill("SIGTERM"));
      } else child.kill("SIGTERM");
    };
    process.once("SIGINT", stop); process.once("SIGTERM", stop);
    const cleanup = () => { process.off("SIGINT", stop); process.off("SIGTERM", stop); };
    child.once("error", () => { cleanup(); reject(new Error("HUB child process could not start.")); });
    child.once("exit", code => {
      cleanup();
      if (stopping && !service) reject(new Error("HUB build was interrupted; rebuild the release before activation."));
      else if (code === 0 || (stopping && service)) resolvePromise();
      else reject(new Error(`HUB child process failed (exit ${code ?? "signal"}); check its configuration and dependencies.`));
    });
  });
}

export async function main(args, inherited = process.env, root = projectRoot) {
  if (!Array.isArray(args) || args.length !== 3 || !/^(?:build|api|web|check-api|check-web)$/.test(args[0]) || args[1] !== "--env-file") {
    fail("Usage: node tools/run-hub.mjs build|api|web|check-api|check-web --env-file /absolute/external/environment.env");
  }
  if (Number(process.versions.node.split(".")[0]) !== 24 || process.execArgv.some(argument => /^--inspect(?:-brk|-wait)?(?:=|$)/.test(argument))) {
    fail("HUB requires its dedicated Node.js 24 runtime without an inspector.");
  }
  const [command, , filename] = args, kind = command.endsWith("api") ? "api" : "web";
  assertNoEnvironmentFiles(root);
  const profile = validateProfile(kind, readEnvironmentFile(kind, filename, root), inherited);
  if (command === "build") {
    // An interrupted rebuild must invalidate any previous successful receipt.
    const marker = join(root, receiptName);
    if (existsSync(marker)) {
      if (!lstatSync(marker).isFile() || lstatSync(marker).isSymbolicLink()) fail("HUB build receipt must be an ordinary file.");
      rmSync(marker);
    }
    for (const nodeArgs of [["node_modules/typescript/bin/tsc", "-p", "shared/contracts/tsconfig.json"],
      ["node_modules/typescript/bin/tsc", "-p", "tsconfig.server.build.json"], ["node_modules/next/dist/bin/next", "build"]]) {
      await runNode(root, profile.environment, nodeArgs);
    }
    writeFileSync(marker, `${JSON.stringify(receipt(profile))}\n`, { flag: "wx", mode: 0o644 });
    assertBuildOutput(root, profile);
    return;
  }
  assertBuildOutput(root, profile);
  if (kind === "api") {
    try {
      // Validate using the same reviewed production composition as the real CLI.
      const { loadRuntimeConfiguration } = await import(pathToFileURL(join(root, "server/dist/runtime/configuration.js")).href);
      loadRuntimeConfiguration(join(root, "server"), profile.environment, () => { throw new Error(); });
    } catch { fail("HUB production runtime configuration failed validation; no fallback or database changes were attempted."); }
  }
  await assertPortFree(profile.host, profile.port);
  if (kind === "web") await assertApiReady(profile);
  if (command.startsWith("check-")) {
    process.stdout.write(kind === "web"
      ? "HUB web configuration, complete build, listener availability, API identity and readiness passed.\n"
      : "HUB API configuration, complete build and listener availability passed; MySQL readiness is verified during API startup.\n");
    return;
  }
  await runNode(root, profile.environment, kind === "api" ? ["server/dist/cli.js"]
    : ["node_modules/next/dist/bin/next", "start", "--hostname", profile.host, "--port", String(profile.port)], true);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main(process.argv.slice(2)).catch(error => {
    process.stderr.write(`${error instanceof Error ? error.message : "HUB startup failed."}\n`);
    process.exitCode = 1;
  });
}
