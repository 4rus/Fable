import "server-only";
import { parse } from "csv-parse/sync";
import { dollarsToCents } from "@/lib/money";
import { MAX_CSV_ROWS } from "@/lib/validation/csvImport";
import { prisma } from "@/lib/db";
import { ForbiddenError } from "@/server/tenant";

export class CsvParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CsvParseError";
  }
}

export interface ParsedExpenseRow {
  incurredAt: Date;
  vendorName: string;
  amountCents: number;
  /** The raw source row, kept only for display in the review table — never
   * trusted again once the user confirms and we move to commitCsvImport. */
  rawLine: string;
}

export interface CsvImportPreview {
  expenseRows: ParsedExpenseRow[];
  skippedIncomeCount: number;
  skippedInvalidCount: number;
  warnings: string[];
}

const DATE_HEADER = /date/i;
const DESCRIPTION_HEADER = /^(description|memo|payee|merchant|name)$/i;
const AMOUNT_HEADER = /^amount$/i;
const DEBIT_HEADER = /^(debit|withdrawal|expense)$/i;
const CREDIT_HEADER = /^(credit|deposit)$/i;

/**
 * Parses a bank/card statement CSV into candidate expense rows.
 *
 * DELIBERATE SCOPE (see the "never invent financial information" rule):
 * this only ever produces EXPENSE rows (money out). A positive amount in
 * the file is a deposit — we have no reliable way to know which invoice,
 * if any, it corresponds to, and guessing would mean fabricating a link
 * between a real bank transaction and a specific customer. Those rows are
 * counted and skipped, not silently dropped; the caller shows the count
 * so the user knows to record those payments manually against the right
 * invoice on /app/invoices instead.
 */
export function parseExpenseCsv(csvText: string): CsvImportPreview {
  let records: Record<string, string>[];
  try {
    records = parse(csvText, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      bom: true,
    });
  } catch (err) {
    throw new CsvParseError(
      `Could not read that as a CSV file (${err instanceof Error ? err.message : "unknown error"}).`,
    );
  }

  if (records.length === 0) {
    throw new CsvParseError("That file has no rows to import.");
  }
  if (records.length > MAX_CSV_ROWS) {
    throw new CsvParseError(`That file has more than ${MAX_CSV_ROWS} rows — split it into smaller files.`);
  }

  const headers = Object.keys(records[0]!);
  const dateKey = headers.find((h) => DATE_HEADER.test(h));
  const descriptionKey = headers.find((h) => DESCRIPTION_HEADER.test(h)) ?? headers.find((h) => !DATE_HEADER.test(h) && !AMOUNT_HEADER.test(h) && !DEBIT_HEADER.test(h) && !CREDIT_HEADER.test(h));
  const amountKey = headers.find((h) => AMOUNT_HEADER.test(h));
  const debitKey = headers.find((h) => DEBIT_HEADER.test(h));
  const creditKey = headers.find((h) => CREDIT_HEADER.test(h));

  if (!dateKey) {
    throw new CsvParseError(`Couldn't find a date column. Columns found: ${headers.join(", ")}.`);
  }
  if (!amountKey && !debitKey && !creditKey) {
    throw new CsvParseError(
      `Couldn't find an amount, debit, or credit column. Columns found: ${headers.join(", ")}.`,
    );
  }

  const expenseRows: ParsedExpenseRow[] = [];
  let skippedIncomeCount = 0;
  let skippedInvalidCount = 0;
  const warnings: string[] = [];

  for (const record of records) {
    const rawLine = Object.values(record).join(", ");
    const dateValue = record[dateKey];
    const date = dateValue ? new Date(dateValue) : null;
    if (!date || Number.isNaN(date.getTime())) {
      skippedInvalidCount++;
      continue;
    }

    // Resolve the signed dollar amount for this row across either shape:
    // a single signed "Amount" column, or separate Debit/Credit columns
    // (where Debit is always an outflow regardless of its own sign).
    let amountDollars: number | null = null;
    let isExpense: boolean;
    if (amountKey) {
      amountDollars = parseAmount(record[amountKey]);
      isExpense = amountDollars !== null && amountDollars < 0;
    } else {
      const debit = debitKey ? parseAmount(record[debitKey]) : null;
      const credit = creditKey ? parseAmount(record[creditKey]) : null;
      if (debit !== null && debit !== 0) {
        amountDollars = -Math.abs(debit);
        isExpense = true;
      } else if (credit !== null && credit !== 0) {
        amountDollars = Math.abs(credit);
        isExpense = false;
      } else {
        skippedInvalidCount++;
        continue;
      }
    }

    // Same $10M sanity ceiling as every other money input in the app —
    // see the long comment on validation/csvImport.ts's amountCents bound
    // for the real bug this closes: a huge (or Infinity-magnitude,
    // e.g. a 400-digit number) value in a bank statement's amount column
    // survived parseAmount()'s format check, then threw inside
    // dollarsToCents() below uncaught by this loop — crashing the WHOLE
    // file's preview, not just skipping the one bad row the way every
    // other kind of invalid amount already does.
    if (amountDollars === null || !Number.isFinite(amountDollars) || Math.abs(amountDollars) > 10_000_000) {
      skippedInvalidCount++;
      continue;
    }
    if (!isExpense) {
      skippedIncomeCount++;
      continue;
    }

    const vendorName = (descriptionKey ? record[descriptionKey] : "") || "Unknown vendor";
    expenseRows.push({
      incurredAt: date,
      vendorName: vendorName.slice(0, 200),
      amountCents: Math.abs(dollarsToCents(amountDollars)),
      rawLine,
    });
  }

  if (expenseRows.length === 0 && skippedIncomeCount === 0) {
    warnings.push("No usable rows were found in this file.");
  }

  return { expenseRows, skippedIncomeCount, skippedInvalidCount, warnings };
}

export interface CommitRow {
  incurredAt: Date;
  vendorName: string;
  amountCents: number;
}

export interface CommitResult {
  createdCount: number;
  duplicateCount: number;
}

/**
 * Creates Expense rows from confirmed CSV import rows. Skips (does not
 * re-create) anything that already exists with the same businessId,
 * categoryId, vendorName, amountCents, and incurredAt day — the practical
 * dedup key if someone imports the same statement file twice, or an
 * overlapping date range from two exports of the same account. Not a
 * perfect general-purpose dedup (a business could legitimately have two
 * identical $9.99 charges to the same vendor on the same day), but a
 * reasonable default that a user can always fix up manually rather than
 * silently double-counting an entire statement.
 */
export async function commitExpenseImport(params: {
  businessId: string;
  categoryId: string;
  rows: CommitRow[];
}): Promise<CommitResult> {
  const category = await prisma.category.findFirst({
    where: { id: params.categoryId, businessId: params.businessId, type: "EXPENSE" },
  });
  if (!category) throw new ForbiddenError("Invalid category for this business");

  let createdCount = 0;
  let duplicateCount = 0;

  for (const row of params.rows) {
    const dayStart = new Date(row.incurredAt);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);

    const existing = await prisma.expense.findFirst({
      where: {
        businessId: params.businessId,
        vendorName: row.vendorName,
        amountCents: row.amountCents,
        incurredAt: { gte: dayStart, lt: dayEnd },
        deletedAt: null,
      },
      select: { id: true },
    });
    if (existing) {
      duplicateCount++;
      continue;
    }

    await prisma.expense.create({
      data: {
        businessId: params.businessId,
        categoryId: params.categoryId,
        vendorName: row.vendorName,
        amountCents: row.amountCents,
        incurredAt: row.incurredAt,
        description: "Imported from CSV",
      },
    });
    createdCount++;
  }

  return { createdCount, duplicateCount };
}

/** Parses a money string from an arbitrary bank export: strips currency
 * symbols/thousands separators, and treats parenthesized amounts as
 * negative (common accounting notation for "(42.50)" = -42.50). Returns
 * null (not NaN, not 0) for anything that isn't actually a number, so
 * callers can tell "zero dollars" apart from "unparseable". */
function parseAmount(raw: string | undefined): number | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const isParenNegative = /^\(.*\)$/.test(trimmed);
  const cleaned = trimmed.replace(/[()$,\s]/g, "");
  if (cleaned === "" || !/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  const value = Number(cleaned);
  return isParenNegative ? -Math.abs(value) : value;
}
