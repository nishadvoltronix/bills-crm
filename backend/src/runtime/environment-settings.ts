/** Backend-only settings. Never import this module into browser contracts. */
export const mysqlEnvironmentKeys = ["CRM_MYSQL_HOST", "CRM_MYSQL_PORT", "CRM_MYSQL_DATABASE",
  "CRM_MYSQL_USER", "CRM_MYSQL_PASSWORD", "CRM_MYSQL_SERVER_UUID", "CRM_MYSQL_APPROVED",
  "CRM_MYSQL_APPROVAL_REFERENCE", "CRM_MYSQL_PROVISIONING_REFERENCE", "CRM_MYSQL_ISSUER_COMPANY",
  "CRM_MYSQL_ISSUER_SALESPERSON"] as const;
export const zohoEnvironmentKeys = ["ZOHO_ENABLED", "ZOHO_CLIENT_ID", "ZOHO_CLIENT_SECRET", "ZOHO_REFRESH_TOKEN"] as const;
type Environment = Readonly<Record<string, string | undefined>>;

/** Configuration storage only: enabling an unimplemented sync must fail closed. */
export function validateZohoEnvironment(environment: Environment): void {
  const keys = new Set<string>(zohoEnvironmentKeys);
  if (Object.keys(environment).some(key => key.startsWith("ZOHO_") && !keys.has(key))
    || (environment.ZOHO_ENABLED !== undefined && environment.ZOHO_ENABLED !== "false")) {
    throw new Error("Zoho synchronization is unavailable; ZOHO_ENABLED must be false.");
  }
  for (const key of zohoEnvironmentKeys.slice(1)) {
    const value = environment[key];
    if (value !== undefined && (Buffer.byteLength(value, "utf8") > 4096 || /[\r\n\0]/.test(value))) {
      throw new Error("Invalid backend integration configuration.");
    }
  }
}

/** Convert explicit environment settings to the SAME v2 validator input.
 * No credential defaults, profile reads, network requests or alternate adapter. */
export function productionProfileFromEnvironment(environment: Environment): unknown {
  for (const key of mysqlEnvironmentKeys) {
    const value = environment[key];
    if (!value?.trim() || /[\r\n\0]/.test(value)) throw new Error("Incomplete production environment configuration.");
  }
  if (environment.CRM_MYSQL_APPROVED !== "true" || !/^(3306|3308)$/.test(environment.CRM_MYSQL_PORT!)) {
    throw new Error("Invalid production environment approval or port.");
  }
  return { version: 2,
    mysql: { provider: "mysql", environment: "production", host: environment.CRM_MYSQL_HOST,
      port: Number(environment.CRM_MYSQL_PORT), database: environment.CRM_MYSQL_DATABASE,
      user: environment.CRM_MYSQL_USER, password: environment.CRM_MYSQL_PASSWORD },
    approval: { approved: true, reference: environment.CRM_MYSQL_APPROVAL_REFERENCE,
      provisioningReference: environment.CRM_MYSQL_PROVISIONING_REFERENCE, serverUuid: environment.CRM_MYSQL_SERVER_UUID },
    issuer: { company: environment.CRM_MYSQL_ISSUER_COMPANY, salesperson: environment.CRM_MYSQL_ISSUER_SALESPERSON } };
}
