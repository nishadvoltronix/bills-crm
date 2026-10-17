import { isLocalPersistence } from "@voltronix/crm-contracts";
import type { QuotationCapabilities, QuotationDetail } from "./persistence-contracts";

type Actor = { localUserId: string; externalUserId: string | null; permissions: readonly string[] };
type Quote = Pick<QuotationDetail, "persistence" | "localOwnerId" | "externalId" | "taskVersion" | "version"> & { task: { assignedExternalId: string | null } };

/** Local ownership is accepted only with positively confirmed server capabilities and the same snapshot. */
export function canOpenQuotationEditor(user: Actor, quote: Quote, capabilities?: QuotationCapabilities): boolean {
  if (!user.permissions.some(key => key === "leads.manage" || key === "leads.manage.agents")) return false;
  if (!isLocalPersistence(quote.persistence)) return user.externalUserId !== null && user.externalUserId === quote.task.assignedExternalId;
  return quote.localOwnerId === user.localUserId && quote.externalId === null && quote.task.assignedExternalId === null
    && capabilities?.persistence === quote.persistence && capabilities.canEdit && !capabilities.discountedEditBlocked && !capabilities.blockedOperationId
    && capabilities.taskVersion === quote.taskVersion && capabilities.quoteVersion === quote.version;
}
