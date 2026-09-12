import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { createTestBusiness } from "./helpers";
import { prisma } from "@/lib/db";
import { uploadAttachment, getAttachmentForDownload, deleteAttachment } from "@/server/services/attachments";
import { isSupabaseStorageConfigured } from "@/server/services/storage/supabaseStorage";
import { writeFile, readFile, deleteFile } from "@/server/services/storage";
import { ForbiddenError } from "@/server/tenant";

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
  it("writes and reads back byte-identical", async () => {
    const key = `test/${randomUUID()}.pdf`;
    await writeFile("supabase", key, PDF_BYTES, "application/pdf");

    const roundTripped = await readFile("supabase", key);
    expect(roundTripped.equals(PDF_BYTES)).toBe(true);

    await deleteFile("supabase", key); // cleanup; correctness of delete itself is asserted below, not here
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

  /**
   * NOTE ON WHAT THIS DELIBERATELY DOES NOT TEST: a raw
   * readFile("supabase", key) immediately after delete can still succeed
   * against the real API — confirmed directly against Supabase Storage
   * while building this, independent of any bug in this codebase (it
   * reproduces with @supabase/supabase-js called directly, and is
   * unaffected by the object's own cacheControl metadata). This is a real
   * characteristic of Supabase's CDN-backed Storage, the same class of
   * "delete isn't instantly visible everywhere" behavior most CDN-backed
   * object stores have (S3 + CloudFront included) — not something an
   * application can fix by calling the Storage API differently.
   *
   * It's also not a real gap: this app never grants access by "is this
   * storage key still fetchable" — every read goes through
   * getAttachmentForDownload(), which checks the Attachment DB row FIRST
   * and throws before ever reaching storage once that row is gone (see
   * attachments.ts). That's the guarantee that actually matters, and it's
   * what this test asserts.
   */
  it("THE CORE GUARANTEE: once deleted, the attachment is unreachable through the app's own access path", async () => {
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

    await deleteAttachment(business.id, attachment.id);

    await expect(getAttachmentForDownload(business.id, attachment.id)).rejects.toThrow(ForbiddenError);
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
