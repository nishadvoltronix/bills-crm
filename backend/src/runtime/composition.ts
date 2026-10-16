import { createAuthService } from "../auth/service.js";
import { createMysqlAuthStore } from "../auth/mysql-store.js";
import { MysqlDatabase } from "../crm/db/mysql/database.js";
import { assertMysqlMigrationsCurrent } from "../crm/db/mysql/migrations.js";
import { assertMysqlRuntimePrivileges } from "../crm/db/mysql/runtime-privileges.js";
import type { MysqlWireConnection } from "../crm/db/mysql/driver.js";
import { assertValidatedRuntimeConfiguration, RuntimeConfigurationError, type RuntimeConfiguration } from "./configuration.js";
import { createCrmServices } from "../crm/router.js";
import { createReadinessProbe } from "./readiness.js";

/** Called for each owned connection, never as implicit migration or repair. */
export async function verifyCrmRuntimeConnection(connection: MysqlWireConnection, config: RuntimeConfiguration, now = Date.now()): Promise<void> {
  try {
    assertValidatedRuntimeConfiguration(config, now);
    const [identity] = await connection.query("SELECT @@server_uuid AS serverUuid,CURRENT_USER() AS identity");
    if (!Array.isArray(identity) || identity.length !== 1 || identity[0]?.serverUuid !== config.serverUuid
      || identity[0]?.identity !== `${config.mysql.user}@127.0.0.1`) throw new Error();
    await assertMysqlRuntimePrivileges(connection, config.mysql.database, config.mysql.port);
    await assertMysqlMigrationsCurrent(connection, config.mysql.database);
  } catch { throw new RuntimeConfigurationError(); }
}

/** Construction opens nothing. HTTP/auth/CRM borrow one lifecycle owner with
 * the full table privilege contract; the narrow auth-only identity is not reused.
 * Neither constructors nor requests apply migrations, import rows or retry writes. */
export function createCrmRuntime(config: RuntimeConfiguration) {
  assertValidatedRuntimeConfiguration(config);
  const database = new MysqlDatabase(config.mysql, { verify: connection => verifyCrmRuntimeConnection(connection, config) });
  const store = createMysqlAuthStore({ transaction: work => database.authTransaction(work) });
  const readiness = createReadinessProbe(async () => {
    // The normal lease verifies identity, privileges and current migrations
    // before this read. No transaction/audit/authentication write is performed.
    const row = await database.prepare("SELECT 1 AS ready").get();
    if (typeof row !== "object" || row === null || !("ready" in row) || row.ready !== 1) throw new RuntimeConfigurationError();
  });
  return { database, auth: createAuthService(store), crmServices: createCrmServices(database,
    config.issuer ? { issuer: config.issuer } : {}), readiness, close: () => database.close() };
}
