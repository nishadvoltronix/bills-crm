export const HISTORICAL_QUOTATION_NOTICE = "This saved quotation uses an earlier calculation policy. Its recorded values are preserved; editing requires an approved historical revision.";

// This is saved creation metadata, not an inferred editable issue/revision date.
export function recordedCreationDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en", { timeZone: "Asia/Dubai", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const part = (type: string) => parts.find(value => value.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}
