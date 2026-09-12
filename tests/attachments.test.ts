import { describe, it, expect } from "vitest";
import { prisma } from "@/lib/db";
import { createTestBusiness } from "./helpers";
import { sniffAttachmentType, sanitizeFilename } from "@/lib/validation/attachments";
import {
  uploadAttachment,
  getAttachmentForDownload,
  deleteAttachment,
  InvalidFileError,
} from "@/server/services/attachments";
import { ForbiddenError } from "@/server/tenant";

// Minimal valid file bytes for each accepted type — real magic-byte
// prefixes, not full valid files (we don't need a renderable image for
// these tests, just something the sniffer genuinely recognizes).
const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const PDF_BYTES = Buffer.from("%PDF-1.4 fake but correctly-prefixed content");
const FAKE_EXE_BYTES = Buffer.from([0x4d, 0x5a, 0x90, 0x00]); // real Windows PE header ("MZ")

describe("sniffAttachmentType", () => {
  it("recognizes real magic bytes regardless of what a filename claims", () => {
    expect(sniffAttachmentType(JPEG_BYTES)).toBe("image/jpeg");
    expect(sniffAttachmentType(PNG_BYTES)).toBe("image/png");
    expect(sniffAttachmentType(PDF_BYTES)).toBe("application/pdf");
  });

  it("rejects content that isn't one of the allowed types, even if small", () => {
    expect(sniffAttachmentType(FAKE_EXE_BYTES)).toBeNull();
    expect(sniffAttachmentType(Buffer.from("just some text"))).toBeNull();
    expect(sniffAttachmentType(Buffer.alloc(0))).toBeNull();
  });

  it("is not fooled by a renamed executable claiming to be a PDF — the actual attack this exists to stop", () => {
    // An attacker uploads malware.exe renamed to receipt.pdf. The claimed
    // filename/extension says PDF; the actual bytes say otherwise.
    expect(sniffAttachmentType(FAKE_EXE_BYTES)).not.toBe("application/pdf");
  });
});

describe("sanitizeFilename", () => {
  it("strips path separators so a filename can't escape its directory", () => {
    expect(sanitizeFilename("../../etc/passwd")).not.toContain("..");
    expect(sanitizeFilename("../../etc/passwd")).not.toContain("/");
    expect(sanitizeFilename("C:\\Windows\\System32\\evil.dll")).not.toContain("\\");
  });

  it("keeps a normal filename intact", () => {
    expect(sanitizeFilename("receipt-2026-01.pdf")).toBe("receipt-2026-01.pdf");
  });

  it("falls back to a safe default for an empty/garbage name", () => {
    expect(sanitizeFilename("")).toBe("attachment");
  });

  it("strips control characters (CR/LF) that could break or inject into a Content-Disposition header", () => {
    const result = sanitizeFilename('receipt\r\nX-Injected: true.pdf');
    expect(result).not.toContain("\r");
    expect(result).not.toContain("\n");
  });
});

async function makeExpense(businessId: string) {
  const category = await prisma.category.create({
    data: { businessId, name: "Supplies", type: "EXPENSE" },
  });
  return prisma.expense.create({
    data: { businessId, categoryId: category.id, vendorName: "Vendor", amountCents: 1000 },
  });
}

describe("uploadAttachment", () => {
  it("stores a valid file and records it against the expense", async () => {
    const business = await createTestBusiness();
    const expense = await makeExpense(business.id);
    const user = await prisma.user.create({
      data: { name: "T", email: `u-${Date.now()}@example.com`, passwordHash: "x" },
    });

    const attachment = await uploadAttachment({
      businessId: business.id,
      expenseId: expense.id,
      filename: "receipt.jpg",
      buffer: JPEG_BYTES,
      uploadedByUserId: user.id,
    });

    expect(attachment.mimeType).toBe("image/jpeg");
    expect(attachment.sizeBytes).toBe(JPEG_BYTES.byteLength);
    // Local disk is the dev-default backend absent Supabase Storage
    // config — see src/server/services/storage/index.ts.
    expect(attachment.provider).toBe("local");

    const { buffer, mimeType } = await getAttachmentForDownload(business.id, attachment.id);
    expect(mimeType).toBe("image/jpeg");
    expect(buffer.equals(JPEG_BYTES)).toBe(true);

    await deleteAttachment(business.id, attachment.id);
    await expect(getAttachmentForDownload(business.id, attachment.id)).rejects.toThrow(ForbiddenError);
  });

  it("rejects a file whose content doesn't match an allowed type", async () => {
    const business = await createTestBusiness();
    const expense = await makeExpense(business.id);
    await expect(
      uploadAttachment({
        businessId: business.id,
        expenseId: expense.id,
        filename: "totally-a-receipt.pdf", // lies about its content
        buffer: FAKE_EXE_BYTES,
        uploadedByUserId: "irrelevant",
      }),
    ).rejects.toThrow(InvalidFileError);
  });

  it("rejects an expense that belongs to a different business (tenant isolation)", async () => {
    const businessA = await createTestBusiness();
    const businessB = await createTestBusiness();
    const expenseOfB = await makeExpense(businessB.id);

    await expect(
      uploadAttachment({
        businessId: businessA.id,
        expenseId: expenseOfB.id,
        filename: "receipt.pdf",
        buffer: PDF_BYTES,
        uploadedByUserId: "irrelevant",
      }),
    ).rejects.toThrow(ForbiddenError);
  });

  it("THE CORE GUARANTEE: a business cannot download another business's attachment even knowing its real id", async () => {
    const businessA = await createTestBusiness();
    const businessB = await createTestBusiness();
    const expenseOfA = await makeExpense(businessA.id);

    const attachment = await uploadAttachment({
      businessId: businessA.id,
      expenseId: expenseOfA.id,
      filename: "receipt.png",
      buffer: PNG_BYTES,
      uploadedByUserId: "irrelevant",
    });

    await expect(getAttachmentForDownload(businessB.id, attachment.id)).rejects.toThrow(ForbiddenError);
    // ...but the owning business can, of course.
    await expect(getAttachmentForDownload(businessA.id, attachment.id)).resolves.toMatchObject({
      mimeType: "image/png",
    });
  });
});
