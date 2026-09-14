import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createTestBusiness } from "./helpers";
import { prisma } from "@/lib/db";

// Same reasoning as narration.test.ts: force the honest not-configured
// path for the tests that specifically exercise it, and let a mocked
// generateFromImage stand in for the real API elsewhere so the JSON
// parsing/validation logic is tested deterministically, no network.
beforeEach(() => vi.stubEnv("ANTHROPIC_API_KEY", ""));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

// 1x1 PNG magic bytes are enough — scanReceiptImage only sniffs the type,
// it never actually decodes the image itself (that's Claude's job, mocked
// below for every test except the not_configured one).
const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0]);

describe("scanReceiptImage", () => {
  it("reports not_configured (never a fake result) when ANTHROPIC_API_KEY is unset", async () => {
    const { scanReceiptImage } = await import("@/server/services/receiptScan");
    const business = await createTestBusiness();
    const result = await scanReceiptImage(business.id, PNG_HEADER);
    expect(result).toEqual({ ok: false, reason: "not_configured" });
  });

  it("rejects an empty file", async () => {
    const { scanReceiptImage } = await import("@/server/services/receiptScan");
    const business = await createTestBusiness();
    const result = await scanReceiptImage(business.id, Buffer.alloc(0));
    expect(result).toEqual({ ok: false, reason: "invalid_file", message: "The file is empty." });
  });

  it("rejects a file that isn't a JPEG or PNG", async () => {
    const { scanReceiptImage } = await import("@/server/services/receiptScan");
    const business = await createTestBusiness();
    const result = await scanReceiptImage(business.id, Buffer.from("not an image"));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("invalid_file");
  });

  it("returns a validated draft from a well-formed model response, with no saved rule yet", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    const anthropic = await import("@/lib/ai/anthropic");
    vi.spyOn(anthropic, "generateFromImage").mockResolvedValue({
      ok: true,
      text: JSON.stringify({ vendorName: "Staples", amountCents: 4599, incurredAt: "2026-01-15" }),
    });

    const { scanReceiptImage } = await import("@/server/services/receiptScan");
    const business = await createTestBusiness();
    const result = await scanReceiptImage(business.id, PNG_HEADER);

    expect(result).toMatchObject({
      ok: true,
      vendorName: "Staples",
      amountCents: 4599,
      incurredAt: "2026-01-15",
    });
  });

  it("suggests a category via the existing keyword rules when the business has a matching category", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    const anthropic = await import("@/lib/ai/anthropic");
    vi.spyOn(anthropic, "generateFromImage").mockResolvedValue({
      ok: true,
      text: JSON.stringify({ vendorName: "Staples", amountCents: 4599, incurredAt: "2026-01-15" }),
    });

    const { scanReceiptImage } = await import("@/server/services/receiptScan");
    const business = await createTestBusiness();
    const suppliesCategory = await prisma.category.create({
      data: { businessId: business.id, name: "Supplies", type: "EXPENSE" },
    });

    const result = await scanReceiptImage(business.id, PNG_HEADER);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.suggestedCategoryId).toBe(suppliesCategory.id);
      expect(result.suggestedCategoryName).toBe("Supplies");
    }
  });

  it("prefers a business's own learned merchant rule over the generic keyword suggestion", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    const anthropic = await import("@/lib/ai/anthropic");
    vi.spyOn(anthropic, "generateFromImage").mockResolvedValue({
      ok: true,
      text: JSON.stringify({ vendorName: "Staples", amountCents: 1000, incurredAt: "2026-01-15" }),
    });

    const { scanReceiptImage } = await import("@/server/services/receiptScan");
    const { normalizeMerchantKey } = await import("@/server/services/bank/categorization");
    const business = await createTestBusiness();
    const officeCategory = await prisma.category.create({
      data: { businessId: business.id, name: "Office Expenses", type: "EXPENSE" },
    });
    await prisma.merchantCategoryRule.create({
      data: { businessId: business.id, merchantKey: normalizeMerchantKey("Staples"), categoryId: officeCategory.id },
    });

    const result = await scanReceiptImage(business.id, PNG_HEADER);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.suggestedCategoryId).toBe(officeCategory.id);
  });

  it("rejects the scan (never a false draft) when the model returns malformed JSON", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    const anthropic = await import("@/lib/ai/anthropic");
    vi.spyOn(anthropic, "generateFromImage").mockResolvedValue({ ok: true, text: "not json at all" });

    const { scanReceiptImage } = await import("@/server/services/receiptScan");
    const business = await createTestBusiness();
    const result = await scanReceiptImage(business.id, PNG_HEADER);
    expect(result).toEqual({ ok: false, reason: "scan_failed", message: "Could not read a result from the receipt scan." });
  });

  it("rejects an out-of-bounds amount rather than silently accepting it", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    const anthropic = await import("@/lib/ai/anthropic");
    vi.spyOn(anthropic, "generateFromImage").mockResolvedValue({
      ok: true,
      text: JSON.stringify({ vendorName: "Staples", amountCents: 99_999_999_999, incurredAt: "2026-01-15" }),
    });

    const { scanReceiptImage } = await import("@/server/services/receiptScan");
    const business = await createTestBusiness();
    const result = await scanReceiptImage(business.id, PNG_HEADER);
    expect(result.ok).toBe(false);
  });

  it("reports an unreadable receipt rather than a fabricated draft when the model signals it isn't one", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    const anthropic = await import("@/lib/ai/anthropic");
    vi.spyOn(anthropic, "generateFromImage").mockResolvedValue({
      ok: true,
      text: JSON.stringify({ vendorName: "", amountCents: 0, incurredAt: "1970-01-01" }),
    });

    const { scanReceiptImage } = await import("@/server/services/receiptScan");
    const business = await createTestBusiness();
    const result = await scanReceiptImage(business.id, PNG_HEADER);
    expect(result.ok).toBe(false);
  });

  it("clamps a future-dated misread to today rather than saving a receipt from the future", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    const anthropic = await import("@/lib/ai/anthropic");
    const farFuture = "2099-01-01";
    vi.spyOn(anthropic, "generateFromImage").mockResolvedValue({
      ok: true,
      text: JSON.stringify({ vendorName: "Staples", amountCents: 500, incurredAt: farFuture }),
    });

    const { scanReceiptImage } = await import("@/server/services/receiptScan");
    const business = await createTestBusiness();
    const result = await scanReceiptImage(business.id, PNG_HEADER);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.incurredAt).not.toBe(farFuture);
      expect(new Date(result.incurredAt).getTime()).toBeLessThanOrEqual(Date.now());
    }
  });
});
