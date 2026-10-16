import { z } from "zod";
import { add, decimal, exact, multiply, percent, subtract } from "../../crm/commercial/decimal.js";
import { calculateQuotation, parseQuotationInput, type QuotationInput } from "../../crm/commercial/quotations.js";

/** Explicit candidate, not metadata approval, a selected runtime or a migration.
 * This tenant exposes custom ItemDiscount (percentage) rather than standard
 * inventory Discount. Never substitute the standard inventory field silently.
 * https://www.zoho.com/crm/developer/docs/api/v8/update-subforms.html
 * https://www.zoho.com/crm/developer/docs/api/v8/update-records.html */
export const ZOHO_V8_QUOTATION_PROFILE = "voltronix-custom-quoted-items-v8" as const;
export type ZohoV8QuotationProfile = typeof ZOHO_V8_QUOTATION_PROFILE;
export type ZohoV8QuotationFailure = "INPUT_INVALID" | "PROFILE_INVALID" | "PRECISION_UNREPRESENTABLE"
  | "UNSUPPORTED_NOTES" | "UNRESOLVED_DESCRIPTION" | "SNAPSHOT_INVALID" | "READBACK_INVALID" | "EDIT_UNSAFE";
export class ZohoV8QuotationError extends Error {
  constructor(readonly code: ZohoV8QuotationFailure) {
    super(`Zoho v8 quotation ${code}. No persistence or network operation was performed.`);
    this.name = "ZohoV8QuotationError";
  }
}
const fail = (code: ZohoV8QuotationFailure): never => { throw new ZohoV8QuotationError(code); };
const id = z.string().regex(/^[1-9][0-9]{0,29}$/);
const timestamp = z.iso.datetime({ offset: true }).refine(value => Number.isFinite(Date.parse(value)));
const text = (maximum: number) => z.string().max(maximum).refine(value => !value.includes("\0"));
const lookup = z.object({ id });
const quoteNumber = text(100).min(1).refine(value => value.trim().length > 0
  && Array.from(value).every(character => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127));
const calendarDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
});
const decimalLexeme = z.string().regex(/^-?(?:0|[1-9][0-9]{0,35})(?:\.[0-9]{1,40})?$/);
const termFields = ["Project", "Terms_of_Payment", "Specification", "General_Exclusion", "Brand", "Warranty", "Delivery"] as const;
type TermField = typeof termFields[number];
type Terms = Record<TermField, string | null>;
type Links = { dealId: string; contactId: string };
type Line = { productId: string; quantity: string; unitPrice: string; itemDiscount: string; uom: string; description: string; netTotal: string };
type Financials = { subtotal: string; discount: string; tax: string; adjustment: string; grandTotal: string };
type Header = Terms & { subject: string; validUntil: string | null };
export interface ZohoV8QuotationSnapshot {
  readonly quoteId: string; readonly quoteNumber: string; readonly modifiedTime: string;
  readonly dealId: string; readonly contactId: string;
  readonly header: Readonly<Header>; readonly financials: Readonly<Financials>;
  readonly lines: readonly Readonly<Line & { rowId: string }>[];
}
type WireLine = { id?: string; Product_Name: { id: string }; Quantity: string; List_Price: string;
  ItemDiscount: string; U_O_M: string; Description: string };
type DeleteLine = { id: string; _delete: null };
type WireQuote = Terms & { Subject: string; Valid_Till: string | null; Deal_Name: { id: string }; Contact_Name: { id: string };
  Discount: string; Tax: string; Adjustment: string; Quoted_Items: (WireLine | DeleteLine)[] };
export interface ZohoV8QuotationPlan {
  readonly profile: ZohoV8QuotationProfile;
  readonly request: { readonly method: "POST" | "PUT"; readonly apiVersion: "v8"; readonly path: string;
    readonly exactDecimalSerialization: "quote-v8"; readonly ifUnmodifiedSince?: string;
    readonly body: { readonly data: readonly [WireQuote] } };
  readonly expected: { readonly dealId: string; readonly contactId: string; readonly quoteId?: string;
    readonly header: Readonly<Header>; readonly financials: Readonly<Financials>;
    readonly lines: readonly Readonly<Line & { rowId: string | null }>[]; readonly deletedRowIds: readonly string[] };
  /** Kept for local labels and percentage provenance; not a persistence result. */
  readonly normalizedInput: QuotationInput;
  readonly financialProfileVerified: false;
  readonly productionAcceptance: false;
  readonly localCommitPerformed: false;
}
const snapshots = new WeakSet<object>(), plans = new WeakSet<object>();
function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
function selected(profile: unknown): void { if (profile !== ZOHO_V8_QUOTATION_PROFILE) fail("PROFILE_INVALID"); }
function parseId(value: unknown): string { const parsed = id.safeParse(value); return parsed.success ? parsed.data : fail("INPUT_INVALID"); }
function canonical(value: string): string {
  const negative = value.startsWith("-");
  const [integer = "0", fraction = ""] = (negative ? value.slice(1) : value).split(".");
  const tail = fraction.replace(/0+$/, "");
  return `${negative && (integer !== "0" || tail) ? "-" : ""}${integer}${tail ? `.${tail}` : ""}`;
}
/** Conservative observed metadata capacity: total decimal digits, not a
 * floating-point approximation. Trailing zeroes carry no numeric precision. */
function wireDecimal(value: string, digits = 16, places = 9, signed = false): string {
  if (!decimalLexeme.safeParse(value).success) return fail("PRECISION_UNREPRESENTABLE");
  const result = canonical(value), magnitude = result.replace(/^-/, ""), [integer = "0", fraction = ""] = magnitude.split(".");
  if ((!signed && result.startsWith("-")) || fraction.length > places
    || integer.length + fraction.length > digits) return fail("PRECISION_UNREPRESENTABLE");
  return result;
}
function input(value: unknown): QuotationInput {
  let quote: QuotationInput;
  try { quote = parseQuotationInput(value); } catch { return fail("INPUT_INVALID"); }
  if (quote.subject.length > 120) return fail("INPUT_INVALID");
  if (quote.notes !== null && quote.notes !== "") return fail("UNSUPPORTED_NOTES");
  if (quote.items.some(item => item.description === "")) return fail("UNRESOLVED_DESCRIPTION");
  if (quote.items.some(item => item.description.length > 2000)) return fail("INPUT_INVALID");
  return quote;
}
function content(quote: QuotationInput, links: Links) {
  const parsedLinks = z.object({ dealId: id, contactId: id }).strict().safeParse(links);
  if (!parsedLinks.success) return fail("INPUT_INVALID");
  const totals = calculateQuotation(quote);
  // Derive VAT from exact taxable, not the presentation-only rounded vatAmount.
  // Derived values may exceed the input decimal parser's 18-digit scale. Keep
  // them as Decimal values until the bounded wire check, never parse/round them.
  const subtotal = quote.items.map(item => {
    const base = multiply(decimal(item.quantity), decimal(item.unitPrice));
    return subtract(base, percent(base, decimal(item.itemDiscount)));
  }).reduce(add, decimal("0"));
  const taxable = subtract(subtotal, percent(subtotal, decimal(quote.discount)));
  const vat = percent(taxable, decimal("5"));
  const grand = add(add(taxable, vat), decimal(quote.adjustment));
  const financials: Financials = { subtotal: totals.exactSubtotal,
    discount: wireDecimal(totals.headerDiscount), tax: wireDecimal(exact(vat)),
    adjustment: wireDecimal(quote.adjustment, 16, 9, true), grandTotal: exact(grand) };
  const header: Header = { subject: quote.subject, validUntil: quote.validUntil, Project: quote.project,
    Terms_of_Payment: quote.termsOfPayment, Specification: quote.specification, General_Exclusion: quote.generalExclusion,
    Brand: quote.brand, Warranty: quote.warranty, Delivery: quote.delivery };
  const lines: Line[] = quote.items.map((item, index) => ({ productId: parseId(item.productId),
    quantity: wireDecimal(item.quantity), unitPrice: wireDecimal(item.unitPrice), itemDiscount: wireDecimal(item.itemDiscount, 5, 2),
    uom: item.uom, description: item.description, netTotal: totals.exactLineTotals[index]! }));
  // Fail before a request exists if derived values exceed the bounded reader.
  if ([financials.subtotal, financials.grandTotal, ...lines.map(line => line.netTotal)]
    .some(value => !decimalLexeme.safeParse(value).success)) return fail("PRECISION_UNREPRESENTABLE");
  const terms = Object.fromEntries(termFields.map(field => [field, header[field]])) as Terms;
  const row: WireQuote = { ...terms, Subject: header.subject, Valid_Till: header.validUntil,
    Deal_Name: { id: parsedLinks.data.dealId }, Contact_Name: { id: parsedLinks.data.contactId },
    Discount: financials.discount, Tax: financials.tax, Adjustment: financials.adjustment,
    Quoted_Items: lines.map(line => wireLine(line)) };
  return { row, header, lines, financials, links: parsedLinks.data };
}
function wireLine(line: Line, rowId?: string): WireLine {
  return { ...(rowId === undefined ? {} : { id: rowId }), Product_Name: { id: line.productId },
    Quantity: line.quantity, List_Price: line.unitPrice, ItemDiscount: line.itemDiscount, U_O_M: line.uom, Description: line.description };
}
function finishPlan(plan: ZohoV8QuotationPlan): ZohoV8QuotationPlan { freeze(plan); plans.add(plan); return plan; }

/** Pure candidate codec. The guarded native service is intentionally unchanged.
 * It proposes the local 5% tax arithmetic, but only a remote readback can compare
 * the tenant's custom formulas; even a match is not production acceptance. */
export function buildZohoV8QuotationCreate(value: unknown, links: Links, profile: ZohoV8QuotationProfile): ZohoV8QuotationPlan {
  selected(profile); const quote = input(value), result = content(quote, links);
  return finishPlan({ profile, request: { method: "POST", apiVersion: "v8", path: "/Quotes", exactDecimalSerialization: "quote-v8",
    body: { data: [result.row] } }, expected: { ...result.links, header: result.header, financials: result.financials,
    lines: result.lines.map(line => ({ ...line, rowId: null })), deletedRowIds: [] }, normalizedInput: quote,
    financialProfileVerified: false, productionAcceptance: false, localCommitPerformed: false });
}

/** A row-ID map is explicit: never match by product ID (duplicates are legal).
 * Zoho appends new subform rows; this profile does not claim row reordering.
 * Missing old IDs are deliberate deletions, not an empty-array blanket reset.
 * Fresh parsed snapshots are required; do not construct them from local JSON. */
export function buildZohoV8QuotationEdit(value: unknown, links: Links, previous: ZohoV8QuotationSnapshot,
  rowIds: readonly (string | null)[], profile: ZohoV8QuotationProfile): ZohoV8QuotationPlan {
  selected(profile);
  if (!previous || !snapshots.has(previous)) return fail("SNAPSHOT_INVALID");
  const quote = input(value), result = content(quote, links);
  if (result.links.dealId !== previous.dealId || result.links.contactId !== previous.contactId
    || !Array.isArray(rowIds) || rowIds.length !== result.lines.length) return fail("EDIT_UNSAFE");
  const retained = new Set<string>(); let lastPosition = -1, seenNew = false;
  const lines = result.lines.map((line, index) => {
    const rowId = rowIds[index];
    if (rowId === null) { seenNew = true; return { ...line, rowId }; }
    if (!id.safeParse(rowId).success || retained.has(rowId!) || seenNew) return fail("EDIT_UNSAFE");
    const position = previous.lines.findIndex(old => old.rowId === rowId);
    if (position < 0 || position <= lastPosition || previous.lines[position]!.productId !== line.productId) return fail("EDIT_UNSAFE");
    lastPosition = position; retained.add(rowId!); return { ...line, rowId: rowId! };
  });
  const deletedRowIds = previous.lines.filter(line => !retained.has(line.rowId)).map(line => line.rowId);
  // Both operations count toward this bounded request, not just final rows.
  if (lines.length + deletedRowIds.length > 200) return fail("EDIT_UNSAFE");
  result.row.Quoted_Items = [...lines.map(line => wireLine(line, line.rowId ?? undefined)),
    ...deletedRowIds.map(rowId => ({ id: rowId, _delete: null }))];
  return finishPlan({ profile, request: { method: "PUT", apiVersion: "v8", path: `/Quotes/${previous.quoteId}`,
    exactDecimalSerialization: "quote-v8", ifUnmodifiedSince: previous.modifiedTime, body: { data: [result.row] } },
  expected: { ...result.links, quoteId: previous.quoteId, header: result.header, financials: result.financials, lines, deletedRowIds },
  normalizedInput: quote, financialProfileVerified: false, productionAcceptance: false, localCommitPerformed: false });
}

const remoteLine = z.object({ id, Product_Name: lookup, Quantity: decimalLexeme, List_Price: decimalLexeme,
  ItemDiscount: decimalLexeme, U_O_M: text(100), Description: text(2000), Net_Total: decimalLexeme,
  Parent_Id: z.object({ id, module: z.object({ api_name: z.literal("Quotes") }).optional() }).optional() });
const remoteQuote = z.object({ id, Quote_No: quoteNumber, Modified_Time: timestamp,
  Deal_Name: lookup, Contact_Name: lookup, Subject: text(200), Valid_Till: calendarDate.nullable(),
  Project: text(10_000).nullable(), Terms_of_Payment: text(10_000).nullable(), Specification: text(10_000).nullable(),
  General_Exclusion: text(10_000).nullable(), Brand: text(10_000).nullable(), Warranty: text(10_000).nullable(), Delivery: text(10_000).nullable(),
  Discount: decimalLexeme, Tax: decimalLexeme, Adjustment: decimalLexeme, Sub_Total: decimalLexeme, Grand_Total: decimalLexeme,
  Quoted_Items: z.array(remoteLine).min(1).max(200), $has_more: z.object({ Quoted_Items: z.literal(false) }) });
function object(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
/** Input must come from the verified client's bounded, lossless JSON reader.
 * Raw JS numbers are refused: precision lost upstream cannot be recovered. */
export function parseZohoV8QuotationReadback(body: unknown, expectedQuoteId: string, profile: ZohoV8QuotationProfile): ZohoV8QuotationSnapshot {
  selected(profile); parseId(expectedQuoteId);
  if (!object(body) || Object.keys(body).some(key => !["data", "info"].includes(key)) || !Array.isArray(body.data)
    || body.data.length !== 1 || !object(body.data[0]) || body.data[0].code !== undefined || body.data[0].error !== undefined
    || (body.info !== undefined && (!object(body.info) || body.info.more_records !== false))) return fail("READBACK_INVALID");
  if (Array.isArray(body.data[0].Quoted_Items) && body.data[0].Quoted_Items.some(line => object(line)
    && (line.code !== undefined || line.error !== undefined))) return fail("READBACK_INVALID");
  const parsed = remoteQuote.safeParse(body.data[0]); if (!parsed.success) return fail("READBACK_INVALID");
  const row = parsed.data;
  if (row.id !== expectedQuoteId || new Set(row.Quoted_Items.map(line => line.id)).size !== row.Quoted_Items.length
    || row.Quoted_Items.some(line => line.Parent_Id && line.Parent_Id.id !== row.id)) return fail("READBACK_INVALID");
  try {
    for (const line of row.Quoted_Items) {
      if (wireDecimal(line.Quantity) === "0") return fail("READBACK_INVALID");
      wireDecimal(line.List_Price);
      const rate = wireDecimal(line.ItemDiscount, 5, 2);
      if (decimal(rate).coefficient > 100n * 10n ** BigInt(decimal(rate).scale)) return fail("READBACK_INVALID");
    }
  } catch { return fail("READBACK_INVALID"); }
  const snapshot: ZohoV8QuotationSnapshot = { quoteId: row.id, quoteNumber: row.Quote_No, modifiedTime: row.Modified_Time,
    dealId: row.Deal_Name.id, contactId: row.Contact_Name.id,
    header: { subject: row.Subject, validUntil: row.Valid_Till, Project: row.Project, Terms_of_Payment: row.Terms_of_Payment,
      Specification: row.Specification, General_Exclusion: row.General_Exclusion, Brand: row.Brand, Warranty: row.Warranty, Delivery: row.Delivery },
    financials: { subtotal: canonical(row.Sub_Total), discount: canonical(row.Discount), tax: canonical(row.Tax),
      adjustment: canonical(row.Adjustment), grandTotal: canonical(row.Grand_Total) },
    lines: row.Quoted_Items.map(line => ({ rowId: line.id, productId: line.Product_Name.id, quantity: canonical(line.Quantity),
      unitPrice: canonical(line.List_Price), itemDiscount: canonical(line.ItemDiscount), uom: line.U_O_M,
      description: line.Description, netTotal: canonical(line.Net_Total) })) };
  freeze(snapshot); snapshots.add(snapshot); return snapshot;
}

export type ZohoV8QuotationMismatch = "QUOTE_ID" | "PARENT" | "HEADER" | "LINE_COUNT" | "LINE_ID" | "LINE_VALUES" | "FINANCIAL_TOTALS";
export function verifyZohoV8QuotationReadback(plan: ZohoV8QuotationPlan, snapshot: ZohoV8QuotationSnapshot) {
  if (!plan || !plans.has(plan)) return fail("INPUT_INVALID");
  if (!snapshot || !snapshots.has(snapshot)) return fail("SNAPSHOT_INVALID");
  const expected = plan.expected, issues = new Set<ZohoV8QuotationMismatch>();
  if (expected.quoteId !== undefined && snapshot.quoteId !== expected.quoteId) issues.add("QUOTE_ID");
  if (snapshot.dealId !== expected.dealId || snapshot.contactId !== expected.contactId) issues.add("PARENT");
  if (JSON.stringify(snapshot.header) !== JSON.stringify(expected.header)) issues.add("HEADER");
  if (snapshot.lines.length !== expected.lines.length) issues.add("LINE_COUNT");
  for (const [index, line] of snapshot.lines.entries()) {
    const desired = expected.lines[index]; if (!desired) continue;
    if ((desired.rowId !== null && desired.rowId !== line.rowId) || expected.deletedRowIds.includes(line.rowId)) issues.add("LINE_ID");
    if (desired.productId !== line.productId || desired.quantity !== line.quantity || desired.unitPrice !== line.unitPrice
      || desired.itemDiscount !== line.itemDiscount || desired.uom !== line.uom || desired.description !== line.description) issues.add("LINE_VALUES");
    if (desired.netTotal !== line.netTotal) issues.add("FINANCIAL_TOTALS");
  }
  if (JSON.stringify(snapshot.financials) !== JSON.stringify(expected.financials)) issues.add("FINANCIAL_TOTALS");
  return { matched: issues.size === 0, issues: [...issues], financialProfileVerified: false as const,
    productionAcceptance: false as const, localCommitPerformed: false as const };
}

/** Single fixed-record read only; not a listing/search or a live invocation. */
export function buildZohoV8QuotationReadRequest(quoteId: string, profile: ZohoV8QuotationProfile) {
  selected(profile); const identifier = parseId(quoteId);
  const fields = ["Quote_No", "Modified_Time", "Deal_Name", "Contact_Name", "Subject", "Valid_Till", ...termFields,
    "Discount", "Tax", "Adjustment", "Sub_Total", "Grand_Total", "Quoted_Items"];
  return { method: "GET" as const, apiVersion: "v8" as const,
    path: `/Quotes/${identifier}?${new URLSearchParams({ fields: fields.join(",") })}` };
}
