import assert from "node:assert/strict";
import test from "node:test";
import { canOpenQuotationEditor } from "../src/server/commercial/edit-access";
import type { QuotationCapabilities } from "../src/server/commercial/persistence-contracts";
const user = { localUserId: "15", externalUserId: null, permissions: ["leads.manage"] };
const quote = { persistence: "local-demo" as const, localOwnerId: "15", externalId: null, taskVersion: 4, version: 2, task: { assignedExternalId: null } };
const capabilities: QuotationCapabilities = { persistence: "local-demo", taskVersion: 4, quoteVersion: 2, canCreate: false, canEdit: true, integrationAvailable: false, discountedEditBlocked: false };

test("local quote editor needs confirmed local owner, capability and exact loaded versions", () => {
  assert.equal(canOpenQuotationEditor(user, quote, capabilities), true);
  assert.equal(canOpenQuotationEditor(user, quote), false);
  assert.equal(canOpenQuotationEditor(user, { ...quote, localOwnerId: "16" }, capabilities), false);
  assert.equal(canOpenQuotationEditor(user, quote, { ...capabilities, persistence: undefined }), false);
  assert.equal(canOpenQuotationEditor(user, quote, { ...capabilities, taskVersion: 5 }), false);
  assert.equal(canOpenQuotationEditor(user, quote, { ...capabilities, quoteVersion: 3 }), false);
});
test("null remote ownership, fabricated mixed provenance, revoked grants and blocked edits refuse", () => {
  assert.equal(canOpenQuotationEditor(user, { ...quote, persistence: undefined }, capabilities), false);
  assert.equal(canOpenQuotationEditor(user, { ...quote, externalId: "9001" }, capabilities), false);
  assert.equal(canOpenQuotationEditor(user, { ...quote, task: { assignedExternalId: "9001" } }, capabilities), false);
  assert.equal(canOpenQuotationEditor({ ...user, permissions: [] }, quote, capabilities), false);
  assert.equal(canOpenQuotationEditor(user, quote, { ...capabilities, canEdit: false }), false);
  assert.equal(canOpenQuotationEditor(user, quote, { ...capabilities, discountedEditBlocked: true }), false);
  assert.equal(canOpenQuotationEditor(user, quote, { ...capabilities, blockedOperationId: "unfinished" }), false);
});
test("remote edit-page ownership remains the existing exact external-identity rule", () => {
  const remote = { ...quote, persistence: undefined, localOwnerId: undefined, externalId: "9002", task: { assignedExternalId: "9001" } };
  assert.equal(canOpenQuotationEditor({ ...user, externalUserId: "9001" }, remote), true);
  assert.equal(canOpenQuotationEditor(user, remote), false);
  assert.equal(canOpenQuotationEditor({ ...user, externalUserId: "9003" }, remote), false);
});

test("MySQL local quote editor retains owner/version/policy checks and rejects mixed providers", () => {
  const mysqlQuote = { ...quote, persistence: "local-mysql" as const };
  const mysqlCapabilities = { ...capabilities, persistence: "local-mysql" as const };
  assert.equal(canOpenQuotationEditor(user, mysqlQuote, mysqlCapabilities), true);
  assert.equal(canOpenQuotationEditor(user, mysqlQuote, capabilities), false);
  assert.equal(canOpenQuotationEditor(user, quote, mysqlCapabilities), false);
  assert.equal(canOpenQuotationEditor(user, mysqlQuote, { ...mysqlCapabilities, taskVersion: 5 }), false);
  assert.equal(canOpenQuotationEditor(user, mysqlQuote, { ...mysqlCapabilities, discountedEditBlocked: true }), false);
  assert.equal(canOpenQuotationEditor({ ...user, localUserId: "16" }, mysqlQuote, mysqlCapabilities), false);
  assert.equal(canOpenQuotationEditor({ ...user, permissions: [] }, mysqlQuote, mysqlCapabilities), false);
});
