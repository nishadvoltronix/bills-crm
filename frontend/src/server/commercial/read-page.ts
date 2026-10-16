import { isLocalPersistence } from "@voltronix/crm-contracts";
import "server-only";
import { notFound, redirect } from "next/navigation";
import { currentUser } from "../frontend-auth";
import { readQuotation, readQuotationCapabilities } from "../frontend-records";
import { canOpenQuotationEditor } from "./edit-access";
export async function readQuotationPage(taskId: string, edit = false) {
  const user = await currentUser(); if (!user) redirect("/login");
  const quote = await readQuotation(taskId);
  if (edit && !canOpenQuotationEditor(user, quote, isLocalPersistence(quote.persistence) ? await readQuotationCapabilities(taskId) : undefined)) notFound();
  return { user, quote };
}
