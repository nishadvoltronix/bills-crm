import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { assertPrivateAccess } from "../runtime/private-profile.js";
import { loadRuntimeConfiguration } from "../runtime/configuration.js";
import { BootstrapAdminError, bootstrapAdministrator, validateBootstrapIdentity, type BootstrapIdentity } from "./bootstrap-admin.js";

const maximumBytes = 8_192;
const samePath = (a: string, b: string) => process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
function within(root: string, path: string): boolean {
  const suffix = relative(root, path);
  return !suffix || (!isAbsolute(suffix) && suffix !== ".." && !suffix.startsWith(`..${sep}`));
}
function assertIdentityProtection(path: string): void {
  assertPrivateAccess(path);
  if (process.platform === "win32") {
    assertPrivateAccess(dirname(path));
    return;
  }
  let cursor = dirname(path);
  while (true) {
    const stat = lstatSync(cursor);
    if (!stat.isDirectory() || (stat.uid !== 0 && stat.uid !== process.getuid?.()) || (stat.mode & 0o022) !== 0) throw new Error();
    const parent = dirname(cursor);
    if (samePath(parent, cursor)) return;
    cursor = parent;
  }
}

export function parseBootstrapArguments(args: readonly string[]) {
  if (args.length !== 4 || args[0] !== "--env-file" || args[2] !== "--identity-file"
    || !isAbsolute(args[1]!) || !isAbsolute(args[3]!) || samePath(resolve(args[1]!), resolve(args[3]!))) {
    throw new BootstrapAdminError("CONFIGURATION");
  }
  return Object.freeze({ environmentFile: args[1]!, identityFile: args[3]! });
}

/** Read explicitly selected canonical JSON outside the release. The operator
 * provisions {version:1,name,email,password} privately before running this CLI.
 * Compact or two-space JSON is accepted; canonical comparison rejects duplicate
 * keys. Never creates, rewrites or removes operator files. Test policy injection
 * does not establish host ACL acceptance. */
export function readBootstrapIdentityFile(root: string, filename: string,
  privateAccess: (path: string) => void = assertIdentityProtection): BootstrapIdentity {
  let descriptor: number | undefined;
  try {
    if (!isAbsolute(filename)) throw new Error();
    const path = resolve(filename), release = realpathSync(root);
    if (within(resolve(root), path) || within(release, path) || !samePath(realpathSync(path), path)) throw new Error();
    let cursor = path;
    while (true) {
      if (lstatSync(cursor).isSymbolicLink() || !samePath(realpathSync(cursor), cursor)) throw new Error();
      const parent = dirname(cursor);
      if (samePath(parent, cursor)) break;
      cursor = parent;
    }
    privateAccess(path);
    const before = lstatSync(path);
    if (!before.isFile() || before.nlink !== 1 || before.size > maximumBytes) throw new Error();
    descriptor = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const opened = fstatSync(descriptor);
    if (!opened.isFile() || opened.nlink !== 1 || opened.dev !== before.dev || opened.ino !== before.ino
      || opened.size !== before.size || opened.mtimeMs !== before.mtimeMs || opened.ctimeMs !== before.ctimeMs) throw new Error();
    const buffer = Buffer.alloc(maximumBytes + 1);
    let length = 0;
    try {
      while (length < buffer.length) {
        const count = readSync(descriptor, buffer, length, buffer.length - length, null);
        if (!count) break;
        length += count;
      }
      if (length !== opened.size || length > maximumBytes) throw new Error();
      const source = new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, length)).replace(/^\uFEFF/, "").replaceAll("\r\n", "\n").trim();
      const parsed: unknown = JSON.parse(source);
      if (source !== JSON.stringify(parsed) && source !== JSON.stringify(parsed, null, 2)) throw new Error();
      for (const after of [fstatSync(descriptor), lstatSync(path)]) {
        if (!after.isFile() || after.isSymbolicLink() || after.dev !== opened.dev || after.ino !== opened.ino || after.nlink !== 1
          || after.size !== opened.size || after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs
          || after.mode !== opened.mode || after.uid !== opened.uid) throw new Error();
      }
      privateAccess(path);
      return validateBootstrapIdentity(parsed);
    } finally { buffer.fill(0); }
  } catch { throw new BootstrapAdminError("IDENTITY"); }
  finally { if (descriptor !== undefined) closeSync(descriptor); }
}

interface HubLauncher {
  assertNoEnvironmentFiles(root: string): void;
  readExternalEnvironment(kind: "api", path: string, root: string): Readonly<Record<string, string>>;
  validateProfile(kind: "api", values: Readonly<Record<string, string>>, inherited: NodeJS.ProcessEnv): {
    environment: Readonly<Record<string, string | undefined>>;
  };
}

export async function runBootstrapCli(args: readonly string[], inherited: NodeJS.ProcessEnv = process.env,
  root = fileURLToPath(new URL("../../../", import.meta.url))) {
  try {
    const selected = parseBootstrapArguments(args);
    if (Number(process.versions.node.split(".")[0]) !== 24 || process.execArgv.some(argument => /^--inspect/.test(argument))) throw new Error();
    // The trusted release's launcher owns the exact shared HUB environment-file
    // allowlist and path policy. No ambient database setting or dotenv is loaded.
    const launcher = await import(pathToFileURL(resolve(root, "tools/run-hub.mjs")).href) as HubLauncher;
    launcher.assertNoEnvironmentFiles(root);
    const profile = launcher.validateProfile("api", launcher.readExternalEnvironment("api", selected.environmentFile, root), inherited);
    const configuration = loadRuntimeConfiguration(resolve(root, "server"), profile.environment, () => { throw new Error(); });
    const identity = readBootstrapIdentityFile(root, selected.identityFile);
    return await bootstrapAdministrator(configuration, identity);
  } catch (error) {
    if (error instanceof BootstrapAdminError) throw error;
    throw new BootstrapAdminError("CONFIGURATION");
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  runBootstrapCli(process.argv.slice(2)).then(result => {
    console.log(JSON.stringify(result));
  }).catch(error => {
    console.error(JSON.stringify({ status: "REFUSED", stage: error instanceof BootstrapAdminError ? error.stage : "CONFIGURATION",
      message: "HUB administrator bootstrap did not complete cleanly. Preserve the private identity file and inspect the target before retrying; no account reset or overwrite is performed." }));
    process.exitCode = 1;
  });
}
