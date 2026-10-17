export const ZOHO_IMPORT_NOTICE = "Read-only Zoho import. This is a local snapshot, not live synchronization. Make changes in Zoho.";

export function ZohoImportNotice({ className = "", detail }: { className?: string; detail?: string }) {
  return <p role="status" className={`alert alert-info ${className}`}>{ZOHO_IMPORT_NOTICE}{detail ? ` ${detail}` : ""}</p>;
}
