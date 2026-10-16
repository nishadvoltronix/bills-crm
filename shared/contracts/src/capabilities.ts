/** Explicit local persistence capabilities. This never certifies remote sync. */
export interface CrmWriteCapabilities {
  persistence: "local-demo" | "local-mysql" | "unavailable";
  productCreate: boolean;
  leadNotes: boolean;
  /** Absent/false until the selected provider's explicit workflow migrations exist. */
  localWorkflow?: boolean;
  dealCreate?: boolean;
  /** Source-backed read filters; independent of local or remote write availability. */
  jobCohorts?: boolean;
  integrationAvailable: false;
}

export interface LocalPersistenceResult { persistence: "local-demo" | "local-mysql" }

/** Presentation discriminator only, never an authorization or provider selector. */
export function isLocalPersistence(value: unknown): value is LocalPersistenceResult["persistence"] {
  return value === "local-demo" || value === "local-mysql";
}
