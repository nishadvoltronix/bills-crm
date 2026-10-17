import { hash } from "bcryptjs";
import { z } from "zod";
import { MysqlDatabase } from "../crm/db/mysql/database.js";
import { verifyCrmRuntimeConnection } from "../runtime/composition.js";
import { assertValidatedRuntimeConfiguration, type RuntimeConfiguration } from "../runtime/configuration.js";
import type { PermissionKey } from "../auth/permissions.js";

/** An initial administrator has explicit grants, never a superuser role bypass.
 * Agent-scoped visibility and employee department roles are not implied. */
export const BOOTSTRAP_ADMIN_PERMISSIONS = Object.freeze([
  "users.write", "permissions.manage", "dashboard.view", "leads.view", "leads.manage",
  "deals.view", "deals.manage", "items.view", "items.write",
] as const satisfies readonly PermissionKey[]);

const noControls = (value: string) => Array.from(value).every(character => character.codePointAt(0)! >= 32 && character.codePointAt(0)! !== 127);
const identitySchema = z.object({
  version: z.literal(1),
  name: z.string().trim().min(1).max(120).refine(noControls),
  email: z.email().max(254).transform(value => value.toLowerCase()),
  password: z.string().min(12).max(72).refine(value => Array.from(value).length >= 12
    && Buffer.byteLength(value, "utf8") <= 72 && noControls(value)),
}).strict();

export type BootstrapIdentity = Readonly<z.infer<typeof identitySchema>>;
export class BootstrapAdminError extends Error {
  constructor(readonly stage: "CONFIGURATION" | "IDENTITY" | "NONEMPTY" | "DATABASE") {
    super("HUB administrator bootstrap refused. Preserve private operator inputs and inspect the target before retrying; no account reset or overwrite is available.");
    this.name = "BootstrapAdminError";
  }
}

export function validateBootstrapIdentity(input: unknown): BootstrapIdentity {
  const parsed = identitySchema.safeParse(input);
  if (!parsed.success) throw new BootstrapAdminError("IDENTITY");
  return Object.freeze(parsed.data);
}

interface BootstrapSql {
  execute(sql: string, values?: readonly unknown[]): Promise<[unknown, unknown]>;
}
export interface BootstrapDatabase {
  authTransaction<T>(work: (transaction: BootstrapSql) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new BootstrapAdminError("DATABASE");
  return value as Record<string, unknown>;
}
function identifier(value: unknown): string {
  if (typeof value === "number" && !Number.isSafeInteger(value)) throw new BootstrapAdminError("DATABASE");
  if (!["string", "number", "bigint"].includes(typeof value)) throw new BootstrapAdminError("DATABASE");
  const id = String(value);
  if (!/^[1-9][0-9]{0,18}$/.test(id) || BigInt(id) > 9_223_372_036_854_775_807n) throw new BootstrapAdminError("DATABASE");
  return id;
}
async function rows(sql: BootstrapSql, statement: string, values: readonly unknown[] = []) {
  const [result] = await sql.execute(statement, values);
  if (!Array.isArray(result)) throw new BootstrapAdminError("DATABASE");
  return result.map(record);
}
async function insert(sql: BootstrapSql, statement: string, values: readonly unknown[]): Promise<Record<string, unknown>> {
  const [value] = await sql.execute(statement, values), result = record(value);
  if (result.affectedRows !== 1 || result.warningStatus !== 0) throw new BootstrapAdminError("DATABASE");
  return result;
}
function assertHubConfiguration(configuration: RuntimeConfiguration): void {
  try {
    assertValidatedRuntimeConfiguration(configuration);
    if (configuration.api.environment !== "production" || configuration.mysql.environment !== "production"
      || configuration.mysql.database !== "voltronix_hub" || configuration.api.instanceId !== "hub-crm"
      || configuration.api.appOrigin !== "https://hub.voltronix.ae") throw new Error();
  } catch { throw new BootstrapAdminError("CONFIGURATION"); }
}

/** Explicit empty-HUB operation only. The real database verifies UUID, exact
 * runtime grants and native migrations on its lease. authTransaction acquires
 * the existing crm_app_lock before checking emptiness and holds it to commit.
 * The dependency seam is for offline tests; startup never invokes this function. */
export async function bootstrapAdministrator(configuration: RuntimeConfiguration, input: unknown,
  options: { openDatabase?: (configuration: RuntimeConfiguration) => BootstrapDatabase } = {}) {
  assertHubConfiguration(configuration);
  const identity = validateBootstrapIdentity(input);
  let database: BootstrapDatabase | undefined;
  let result: Readonly<{ status: "ADMIN_CREATED"; userId: string; permissionCount: number }> | undefined;
  let failure: BootstrapAdminError | undefined;
  try {
    const passwordHash = await hash(identity.password, 12);
    assertHubConfiguration(configuration);
    database = options.openDatabase ? options.openDatabase(configuration) : new MysqlDatabase(configuration.mysql,
      { verify: connection => verifyCrmRuntimeConnection(connection, configuration) });
    result = await database.authTransaction(async sql => {
      if ((await rows(sql, "SELECT CAST(id AS CHAR) AS id FROM users LIMIT 1")).length !== 0) {
        throw new BootstrapAdminError("NONEMPTY");
      }
      const user = await insert(sql, "INSERT INTO users(username,email,password,status) VALUES(?,?,?,'active')",
        [identity.name, identity.email, passwordHash]);
      const userId = identifier(user.insertId);
      for (const key of BOOTSTRAP_ADMIN_PERMISSIONS) {
        const existing = await rows(sql, "SELECT CAST(id AS CHAR) AS id FROM permissions WHERE `key`=? LIMIT 2", [key]);
        if (existing.length > 1) throw new BootstrapAdminError("DATABASE");
        const permissionId = existing.length ? identifier(existing[0]!.id) : identifier((await insert(sql,
          "INSERT INTO permissions(`key`,label) VALUES(?,?)", [key, key])).insertId);
        await insert(sql, "INSERT INTO admin_user_permissions(admin_user_id,permission_id) VALUES(?,?)", [userId, permissionId]);
      }
      for (const [action, fields] of [["users.create", ["name", "email", "password", "status"]],
        ["grants.replace", ["permissionIds"]]] as const) {
        await insert(sql, "INSERT INTO crm_audit_events(actor_user_id,target_type,target_id,action,changed_fields) VALUES(?,'users',?,?,?)",
          [userId, userId, action, JSON.stringify(fields)]);
      }
      return Object.freeze({ status: "ADMIN_CREATED" as const, userId, permissionCount: BOOTSTRAP_ADMIN_PERMISSIONS.length });
    });
  } catch (error) {
    failure = error instanceof BootstrapAdminError ? error : new BootstrapAdminError("DATABASE");
  } finally {
    if (database) {
      try { await database.close(); } catch { failure ??= new BootstrapAdminError("DATABASE"); }
    }
  }
  if (failure) throw failure;
  if (!result) throw new BootstrapAdminError("DATABASE");
  return result;
}
