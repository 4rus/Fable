import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { createTestBusiness } from "./helpers";
import { prisma } from "@/lib/db";
import { uploadAttachment, getAttachmentForDownload, deleteAttachment } from "@/server/services/attachments";
import { isSupabaseStorageConfigured } from "@/server/services/storage/supabaseStorage";
import { writeFile, readFile, deleteFile } from "@/server/services/storage";

/**
 * Real integration tests against Supabase Storage's actual API — not
 * mocked, same philosophy as tests/bank-connections.test.ts (real Plaid
 * Sandbox) and tests/invoice-email.test.ts (real Resend). Skips entirely
 * (not a failure) if SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY aren't
 * configured, matching how the rest of the suite treats optional
 * provider credentials — see README "Environment variables".
 */

const SUPABASE_STORAGE_CONFIGURED = isSupabaseStorageConfigured();
const describeIfConfigured = SUPABASE_STORAGE_CONFIGURED ? describe : describe.skip;

const PDF_BYTES = Buffer.from("%PDF-1.4 fake but correctly-prefixed content");

describeIfConfigured("Supabase Storage backend (real API)", () => {
  it("writes, reads back byte-identical, and deletes a file", async () => {
    const key = `test/${randomUUID()}.pdf`;
    await writeFile("supabase", key, PDF_BYTES, "application/pdf");

    const roundTripped = await readFile("supabase", key);
    expect(roundTripped.equals(PDF_BYTES)).toBe(true);

    await deleteFile("supabase", key);
    await expect(readFile("supabase", key)).rejects.toThrow();
  });

  it("uploadAttachment records provider=\"supabase\" and getAttachmentForDownload reads back through it", async () => {
    const business = await createTestBusiness();
    const category = await prisma.category.create({ data: { businessId: business.id, name: "Supplies", type: "EXPENSE" } });
    const expense = await prisma.expense.create({
      data: { businessId: business.id, categoryId: category.id, vendorName: "Vendor", amountCents: 1000 },
    });

    const attachment = await uploadAttachment({
      businessId: business.id,
      expenseId: expense.id,
      filename: "receipt.pdf",
      buffer: PDF_BYTES,
      uploadedByUserId: "irrelevant",
    });
    expect(attachment.provider).toBe("supabase");

    const { buffer } = await getAttachmentForDownload(business.id, attachment.id);
    expect(buffer.equals(PDF_BYTES)).toBe(true);

    await deleteAttachment(business.id, attachment.id);
  });
});

describe("Supabase Storage module", () => {
  it("is exercised against the real API only when SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY are set", () => {
    // A visible marker in the test output for why the suite above was
    // skipped, rather than a silent gap -- see describeIfConfigured above.
    if (!SUPABASE_STORAGE_CONFIGURED) {
      console.warn(
        "SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY not set -- skipping real Supabase Storage integration tests.",
      );
    }
    expect(true).toBe(true);
  });
});
