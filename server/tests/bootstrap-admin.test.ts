import assert from "node:assert/strict";
import { chmodSync, linkSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compare, getRounds } from "bcryptjs";
import test from "node:test";
import { BOOTSTRAP_ADMIN_PERMISSIONS, BootstrapAdminError, bootstrapAdministrator, validateBootstrapIdentity,
  type BootstrapDatabase } from "../src/operations/bootstrap-admin.js";
import { parseBootstrapArguments, readBootstrapIdentityFile, runBootstrapCli } from "../src/operations/bootstrap-admin-cli.js";
import { validateRuntimeConfiguration, type RuntimeConfiguration } from "../src/runtime/configuration.js";

const identity = { version: 1, name: "Synthetic Operator", email: "Synthetic.Operator@invalid.example", password: "Synthetic-only-password-2026" };
function configuration(patch: { database?: string; origin?: string; instanceId?: string } = {}) {
  return validateRuntimeConfiguration({ version: 2,
    mysql: { provider: "mysql", environment: "production", host: "127.0.0.1", port: 3306,
      database: patch.database ?? "voltronix_hub", user: "synthetic_hub_runtime", password: "synthetic-database-secret" },
    approval: { approved: true, reference: "Synthetic offline bootstrap approval", provisioningReference: "Synthetic offline provisioning",
      serverUuid: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" },
    issuer: { company: "VOLTRONIX CONTRACTING LLC", salesperson: "Synthetic approved issuer" } },
  { environment: "production", host: "127.0.0.1", port: 3002,
    appOrigin: patch.origin ?? "https://hub.voltronix.ae", instanceId: patch.instanceId ?? "hub-crm" });
}

interface FixtureState {
  users: { id: string; name: string; email: string; password: string; status: string }[];
  permissions: { id: string; key: string; label: string }[];
  grants: { userId: string; permissionId: string }[];
  audits: { actor: string; target: string; action: string; fields: string }[];
}
interface FixtureSql { execute(sql: string, values?: readonly unknown[]): Promise<[unknown, unknown]> }
/** Offline transaction model. It makes no connection and does not substitute
 * for the production owner's UUID/grant/schema or host-permission checks. */
class Fixture implements BootstrapDatabase {
  state: FixtureState = { users: [], permissions: [], grants: [], audits: [] };
  calls: { sql: string; values: readonly unknown[] }[] = [];
  committed = 0;
  rolledBack = 0;
  closed = 0;
  fail: "grant" | "warning" | undefined;
  private queue: Promise<void> = Promise.resolve();
  async authTransaction<T>(work: (sql: FixtureSql) => Promise<T>): Promise<T> {
    const previous = this.queue;
    let release!: () => void;
    this.queue = new Promise<void>(resolve => { release = resolve; });
    await previous;
    const next = structuredClone(this.state);
    const execute = async (sql: string, values: readonly unknown[] = []): Promise<[unknown, unknown]> => {
      this.calls.push({ sql, values });
      const header = (insertId: string) => [{ insertId, affectedRows: 1, warningStatus: this.fail === "warning" ? 1 : 0 }, []] as [unknown, unknown];
      if (sql.startsWith("SELECT CAST(id AS CHAR) AS id FROM users")) return [next.users.slice(0, 1).map(({ id }) => ({ id })), []];
      if (sql.startsWith("SELECT CAST(id AS CHAR) AS id FROM permissions")) return [next.permissions.filter(row => row.key === values[0]).map(({ id }) => ({ id })), []];
      if (sql.startsWith("INSERT INTO users(")) {
        const id = "1";
        next.users.push({ id, name: String(values[0]), email: String(values[1]), password: String(values[2]), status: "active" });
        return header(id);
      }
      if (sql.startsWith("INSERT INTO permissions(")) {
        const id = String(next.permissions.length + 1);
        next.permissions.push({ id, key: String(values[0]), label: String(values[1]) });
        return header(id);
      }
      if (sql.startsWith("INSERT INTO admin_user_permissions(")) {
        if (this.fail === "grant") throw new Error(`Private driver message ${identity.password}`);
        next.grants.push({ userId: String(values[0]), permissionId: String(values[1]) });
        return header(String(next.grants.length));
      }
      if (sql.startsWith("INSERT INTO crm_audit_events(")) {
        next.audits.push({ actor: String(values[0]), target: String(values[1]), action: String(values[2]), fields: String(values[3]) });
        return header(String(next.audits.length));
      }
      assert.fail("Unexpected bootstrap SQL in offline transaction");
    };
    try {
      const result = await work({ execute });
      this.state = next;
      this.committed++;
      return result;
    } catch (error) { this.rolledBack++; throw error; }
    finally { release(); }
  }
  async close() { this.closed++; }
}
const options = (fixture: Fixture) => ({ openDatabase: () => fixture });
const refusal = (stage: BootstrapAdminError["stage"]) => (error: unknown) => error instanceof BootstrapAdminError
  && error.stage === stage && !error.message.includes(identity.password) && !error.message.includes(identity.email);

test("OFFLINE bootstrap accepts only explicit validated production HUB ownership before database construction", async () => {
  let opened = 0;
  for (const config of [configuration({ database: "unrelated_crm" }), configuration({ origin: "https://bills.voltronix.ae" }),
    configuration({ instanceId: "bills-crm" }), { ...configuration() } as RuntimeConfiguration]) {
    await assert.rejects(bootstrapAdministrator(config, identity, { openDatabase() { opened++; return new Fixture(); } }), refusal("CONFIGURATION"));
  }
  assert.equal(opened, 0);
});

test("OFFLINE bootstrap requires explicit valid identity and bcrypt-safe password without optional privilege input", async () => {
  let opened = 0;
  for (const patch of [{ name: "" }, { name: "bad\nname" }, { email: "" }, { email: "not-an-email" },
    { password: "short" }, { password: "x".repeat(73) }, { password: "é".repeat(37) }, { password: "valid-length\0invalid" },
    { role: "admin" }, { permissions: ["leads.manage.agents"] }]) {
    await assert.rejects(bootstrapAdministrator(configuration(), { ...identity, ...patch }, {
      openDatabase() { opened++; return new Fixture(); },
    }), refusal("IDENTITY"));
  }
  assert.equal(opened, 0);
  const validated = validateBootstrapIdentity(identity);
  assert.equal(validated.email, identity.email.toLowerCase());
  assert.ok(Object.isFrozen(validated));
});

test("OFFLINE empty HUB bootstrap stores bcrypt12, exact grants and secret-free audit atomically", async () => {
  const fixture = new Fixture();
  const result = await bootstrapAdministrator(configuration(), identity, options(fixture));
  assert.deepEqual(result, { status: "ADMIN_CREATED", userId: "1", permissionCount: 9 });
  assert.equal(fixture.committed, 1);
  assert.equal(fixture.closed, 1);
  const [user] = fixture.state.users;
  assert.equal(user?.email, identity.email.toLowerCase());
  assert.equal(user?.status, "active");
  assert.equal(getRounds(user!.password), 12);
  assert.equal(await compare(identity.password, user!.password), true);
  assert.deepEqual(fixture.state.permissions.map(row => row.key), [...BOOTSTRAP_ADMIN_PERMISSIONS]);
  assert.equal(fixture.state.grants.length, 9);
  assert.ok(fixture.state.grants.every(row => row.userId === user!.id));
  assert.equal(fixture.state.permissions.some(row => row.key === "leads.manage.agents"), false);
  assert.deepEqual(fixture.state.audits.map(row => row.action), ["users.create", "grants.replace"]);
  assert.equal(JSON.stringify([fixture.calls, result]).includes(identity.password), false);
  assert.ok(fixture.calls.every(call => /^(?:SELECT|INSERT) /.test(call.sql) && !call.sql.includes(identity.email)));
});

test("OFFLINE nonempty target refuses instead of overwriting, rehashing, granting or resetting accounts", async () => {
  const fixture = new Fixture();
  fixture.state.users.push({ id: "9", name: "Existing operator", email: identity.email.toLowerCase(), password: "retained-private-hash", status: "inactive" });
  const before = structuredClone(fixture.state);
  await assert.rejects(bootstrapAdministrator(configuration(), identity, options(fixture)), refusal("NONEMPTY"));
  assert.deepEqual(fixture.state, before);
  assert.equal(fixture.calls.length, 1);
  assert.equal(fixture.committed, 0);
  assert.equal(fixture.closed, 1);
});

test("OFFLINE bootstrap preserves an existing permission catalogue without updating its labels", async () => {
  const fixture = new Fixture();
  fixture.state.permissions.push({ id: "1", key: "users.write", label: "Owner-approved catalogue label" });
  await bootstrapAdministrator(configuration(), identity, options(fixture));
  assert.equal(fixture.state.permissions[0]?.label, "Owner-approved catalogue label");
  assert.equal(fixture.state.permissions.length, 9);
  assert.equal(fixture.state.grants[0]?.permissionId, "1");
});

test("OFFLINE grant failure rolls back user, catalogue, grants and audits and redacts driver details", async () => {
  const fixture = new Fixture(); fixture.fail = "grant";
  await assert.rejects(bootstrapAdministrator(configuration(), identity, options(fixture)), refusal("DATABASE"));
  assert.deepEqual(fixture.state, { users: [], permissions: [], grants: [], audits: [] });
  assert.equal(fixture.rolledBack, 1);
  assert.equal(fixture.committed, 0);
  assert.equal(fixture.closed, 1);
});

test("OFFLINE SQL warnings are rejected as partial bootstrap failure", async () => {
  const fixture = new Fixture(); fixture.fail = "warning";
  await assert.rejects(bootstrapAdministrator(configuration(), identity, options(fixture)), refusal("DATABASE"));
  assert.equal(fixture.state.users.length, 0);
  assert.equal(fixture.rolledBack, 1);
});

test("OFFLINE connection-close failure does not report success or expose a driver diagnostic after commit", async () => {
  const fixture = new Fixture();
  fixture.close = async () => { throw new Error(`Private socket diagnostic ${identity.password}`); };
  await assert.rejects(bootstrapAdministrator(configuration(), identity, options(fixture)), refusal("DATABASE"));
  // A close failure cannot undo a completed commit. The CLI tells the operator
  // to retain the private credential and inspect state rather than reset/retry.
  assert.equal(fixture.state.users.length, 1);
  assert.equal(fixture.committed, 1);
});

test("OFFLINE serialized bootstrap invocations cannot create a second administrator", async () => {
  const fixture = new Fixture();
  const results = await Promise.allSettled([bootstrapAdministrator(configuration(), identity, options(fixture)),
    bootstrapAdministrator(configuration(), { ...identity, email: "second@invalid.example" }, options(fixture))]);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  const rejected = results.find(result => result.status === "rejected");
  assert.ok(rejected?.status === "rejected" && refusal("NONEMPTY")(rejected.reason));
  assert.equal(fixture.state.users.length, 1);
  assert.equal(fixture.committed, 1);
});

test("OFFLINE CLI accepts only distinct absolute external file selections", () => {
  const backend = join(tmpdir(), "synthetic-backend.env"), input = join(tmpdir(), "synthetic-onboarding.json");
  assert.deepEqual(parseBootstrapArguments(["--env-file", backend, "--identity-file", input]), { environmentFile: backend, identityFile: input });
  for (const args of [[], ["--password", identity.password], ["--env-file", "relative.env", "--identity-file", input],
    ["--env-file", backend, "--identity-file", backend], ["--env-file", backend, "--identity-file", input, "--overwrite"]]) {
    assert.throws(() => parseBootstrapArguments(args), refusal("CONFIGURATION"));
  }
});

function withFiles(work: (root: string, input: string, parent: string) => void) {
  const parent = realpathSync(mkdtempSync(join(tmpdir(), "hub-bootstrap-offline-"))), root = join(parent, "release"), input = join(parent, "onboarding.json");
  mkdirSync(root);
  writeFileSync(input, `${JSON.stringify(identity, null, 2)}\n`, { mode: 0o600 });
  try { work(root, input, parent); } finally { rmSync(parent, { recursive: true, force: true }); }
}

test("OFFLINE identity reader uses only the selected external file and calls the private-access policy before/after reading", () => withFiles((root, input) => {
  const calls: string[] = [], before = readFileSync(input);
  assert.deepEqual(readBootstrapIdentityFile(root, input, path => { calls.push(path); }), validateBootstrapIdentity(identity));
  assert.deepEqual(calls, [input, input]);
  assert.deepEqual(readFileSync(input), before);
}));

test("OFFLINE identity reader refuses release-local inputs, hard links, malformed JSON, duplicate keys and excessive files", () => withFiles((root, input, parent) => {
  const inside = join(root, "private-identity.json"); writeFileSync(inside, JSON.stringify(identity));
  assert.throws(() => readBootstrapIdentityFile(root, inside, () => {}), refusal("IDENTITY"));
  const alias = join(parent, "linked.json"); linkSync(input, alias);
  assert.throws(() => readBootstrapIdentityFile(root, input, () => {}), refusal("IDENTITY"));
  rmSync(alias);
  for (const source of ["{", `{"version":1,"version":1,"name":"Synthetic","email":"fake@invalid.example","password":"${identity.password}"}`,
    JSON.stringify({ ...identity, overwrite: true }), " ".repeat(8193)]) {
    writeFileSync(input, source);
    assert.throws(() => readBootstrapIdentityFile(root, input, () => {}), refusal("IDENTITY"));
  }
}));

test("OFFLINE identity reader rejects directory aliases and private-access failures without exposing diagnostics", () => withFiles((root, input, parent) => {
  assert.throws(() => readBootstrapIdentityFile(root, input, () => { throw new Error(`Private ACL ${identity.password}`); }), refusal("IDENTITY"));
  const directory = join(parent, "alias");
  symlinkSync(parent, directory, process.platform === "win32" ? "junction" : "dir");
  assert.throws(() => readBootstrapIdentityFile(root, join(directory, "onboarding.json"), () => {}), refusal("IDENTITY"));
  rmSync(directory);
  if (process.platform !== "win32") {
    chmodSync(input, 0o644);
    assert.throws(() => readBootstrapIdentityFile(root, input), refusal("IDENTITY"));
  }
}));

test("OFFLINE invalid CLI selection returns only a fixed safe refusal without importing a launcher or connecting", async () => {
  await assert.rejects(runBootstrapCli(["--password", identity.password], {}), refusal("CONFIGURATION"));
});
