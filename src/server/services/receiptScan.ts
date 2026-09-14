import "server-only";
import { z } from "zod";
import { generateFromImage } from "@/lib/ai/anthropic";
import { sniffAttachmentType, MAX_ATTACHMENT_SIZE_BYTES } from "@/lib/validation/attachments";
import { categorizeBySavedRule, suggestCategoryForTransaction } from "@/server/services/bank/categorization";
import { prisma } from "@/lib/db";

/**
 * RECEIPT SCANNING (feature request, 2026-09). Reads a photographed/
 * scanned receipt with Claude's vision and returns a DRAFT the user must
 * review and confirm — nothing is written to the database from this
 * module. Same "AI is not the source of truth for financial facts"
 * principle the rest of the app follows (see narration.ts): the numbers
 * here come from the receipt image itself (real OCR of a real document,
 * not an invented figure), but the model can still misread a smudged
 * total or a foreign date format, so every field is bounds-checked and
 * the user always sees a normal, editable expense form before anything
 * is saved — exactly the same "confirm before write" shape Phase G uses
 * for bank-transaction categorization.
 *
 * Category suggestion reuses the existing merchant-rule engine
 * (src/server/services/bank/categorization.ts) instead of asking Claude
 * to guess one — deterministic, and it gets smarter over time the same
 * way bank-transaction categorization already does, rather than a second
 * independent guesser that could disagree with it.
 */

export type ReceiptScanResult =
  | {
      ok: true;
      vendorName: string;
      amountCents: number;
      incurredAt: string; // YYYY-MM-DD
      suggestedCategoryId: string | null;
      suggestedCategoryName: string | null;
    }
  | { ok: false; reason: "not_configured" }
  | { ok: false; reason: "invalid_file"; message: string }
  | { ok: false; reason: "scan_failed"; message: string };

const MAX_AMOUNT_CENTS = 1_000_000_000; // $10M ceiling — same sanity bound used everywhere else in the app

const extractedReceiptSchema = z.object({
  vendorName: z.string().trim().min(1).max(200),
  amountCents: z.number().int().nonnegative().max(MAX_AMOUNT_CENTS),
  // Claude is asked for YYYY-MM-DD; z.coerce.date() also accepts that and
  // rejects garbage rather than silently producing "Invalid Date".
  incurredAt: z.coerce.date(),
});

const SYSTEM_PROMPT = `You read receipt images and extract structured data. Respond with ONLY a single JSON object, no prose, no markdown fences, matching exactly this shape:
{"vendorName": string, "amountCents": integer, "incurredAt": "YYYY-MM-DD"}

Rules:
- amountCents is the receipt's TOTAL amount charged, in integer cents (e.g. $12.50 -> 1250). Never include a currency symbol.
- incurredAt is the transaction/purchase date printed on the receipt, as YYYY-MM-DD. If no date is visible, use today's date.
- vendorName is the merchant/business name as printed, not an address or slogan.
- If the image is not a receipt or is unreadable, respond with {"vendorName": "", "amountCents": 0, "incurredAt": "1970-01-01"} exactly.`;

/** Scans one receipt image and returns a draft expense the caller must
 * still have a human confirm. Never persists anything. */
export async function scanReceiptImage(
  businessId: string,
  buffer: Buffer,
): Promise<ReceiptScanResult> {
  if (buffer.byteLength === 0) {
    return { ok: false, reason: "invalid_file", message: "The file is empty." };
  }
  if (buffer.byteLength > MAX_ATTACHMENT_SIZE_BYTES) {
    return {
      ok: false,
      reason: "invalid_file",
      message: `That file is larger than the ${MAX_ATTACHMENT_SIZE_BYTES / (1024 * 1024)}MB limit.`,
    };
  }

  const detectedType = sniffAttachmentType(buffer);
  if (detectedType !== "image/jpeg" && detectedType !== "image/png") {
    // PDF receipts aren't supported by this feature yet (documented gap,
    // not silently dropped) — a PDF can still be attached to an expense
    // by hand the normal way, it just won't be auto-read.
    return {
      ok: false,
      reason: "invalid_file",
      message: "Only JPEG or PNG receipt photos can be scanned right now (PDF isn't supported yet).",
    };
  }

  const response = await generateFromImage({
    system: SYSTEM_PROMPT,
    prompt: "Extract this receipt's data as the specified JSON object.",
    imageBase64: buffer.toString("base64"),
    mediaType: detectedType,
    maxTokens: 300,
  });

  if (!response.ok) {
    return response.reason === "not_configured"
      ? { ok: false, reason: "not_configured" }
      : { ok: false, reason: "scan_failed", message: response.message };
  }

  let raw: unknown;
  try {
    // Defensive: strip a markdown fence if the model added one anyway,
    // rather than failing the whole scan over formatting.
    const cleaned = response.text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
    raw = JSON.parse(cleaned);
  } catch {
    return { ok: false, reason: "scan_failed", message: "Could not read a result from the receipt scan." };
  }

  const parsed = extractedReceiptSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, reason: "scan_failed", message: "Could not read a result from the receipt scan." };
  }

  if (!parsed.data.vendorName || parsed.data.amountCents === 0) {
    return { ok: false, reason: "scan_failed", message: "That doesn't look like a readable receipt — try a clearer photo, or enter it manually." };
  }

  // Never let a misread date land far in the future — a real receipt
  // can't be from tomorrow. Clamp to today rather than reject outright,
  // since the vendor/amount may still be perfectly readable.
  const incurredAt = parsed.data.incurredAt > new Date() ? new Date() : parsed.data.incurredAt;

  const savedRule = await categorizeBySavedRule(businessId, parsed.data.vendorName, "");
  let suggestedCategoryId: string | null = null;
  let suggestedCategoryName: string | null = null;
  if (savedRule) {
    const category = await prisma.category.findUnique({ where: { id: savedRule.categoryId }, select: { id: true, name: true } });
    if (category) {
      suggestedCategoryId = category.id;
      suggestedCategoryName = category.name;
    }
  } else {
    const suggestion = await suggestCategoryForTransaction(businessId, parsed.data.vendorName, "");
    if (suggestion) {
      suggestedCategoryId = suggestion.categoryId;
      suggestedCategoryName = suggestion.categoryName;
    }
  }

  return {
    ok: true,
    vendorName: parsed.data.vendorName,
    amountCents: parsed.data.amountCents,
    incurredAt: incurredAt.toISOString().slice(0, 10),
    suggestedCategoryId,
    suggestedCategoryName,
  };
}
