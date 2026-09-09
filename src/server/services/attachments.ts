import "server-only";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/db";
import { logError } from "@/lib/logger";
import { ForbiddenError } from "@/server/tenant";
import {
  MAX_ATTACHMENT_SIZE_BYTES,
  sniffAttachmentType,
  sanitizeFilename,
  type AllowedAttachmentType,
} from "@/lib/validation/attachments";

export class InvalidFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidFileError";
  }
}

// TODO(production): local disk does not survive a redeploy and does not
// work past a single server instance. Swap UPLOAD_ROOT for an S3-
// compatible object store with private ACLs before deploying anywhere
// that isn't a single long-lived instance — see README "Deployment".
const UPLOAD_ROOT = path.resolve(process.cwd(), "uploads");

const EXTENSION_BY_TYPE: Record<AllowedAttachmentType, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "application/pdf": "pdf",
};

/**
 * Validates, stores, and records an uploaded receipt against an expense.
 * The expense must belong to `businessId` — this is the tenant check,
 * baked into the query rather than assumed from the caller.
 *
 * File-write-then-DB-row ordering is deliberate: if the DB insert fails
 * after a successful write, we leak an orphaned file (recoverable, e.g. by
 * a periodic sweep of storage keys with no matching row) — the reverse
 * order would risk a DB row pointing at a file that was never actually
 * written, which breaks every future download of it.
 */
export async function uploadAttachment(params: {
  businessId: string;
  expenseId: string;
  filename: string;
  buffer: Buffer;
  uploadedByUserId: string;
}) {
  if (params.buffer.byteLength === 0) {
    throw new InvalidFileError("The file is empty.");
  }
  if (params.buffer.byteLength > MAX_ATTACHMENT_SIZE_BYTES) {
    throw new InvalidFileError(
      `That file is larger than the ${MAX_ATTACHMENT_SIZE_BYTES / (1024 * 1024)}MB limit.`,
    );
  }

  // The security-relevant check: what does the file actually contain,
  // regardless of its claimed name or Content-Type.
  const detectedType = sniffAttachmentType(params.buffer);
  if (!detectedType) {
    throw new InvalidFileError("Only JPEG, PNG, or PDF files are accepted.");
  }

  const expense = await prisma.expense.findFirst({
    where: { id: params.expenseId, businessId: params.businessId, deletedAt: null },
  });
  if (!expense) throw new ForbiddenError("Expense not found for this business");

  const storageKey = `${params.businessId}/${randomUUID()}.${EXTENSION_BY_TYPE[detectedType]}`;
  const absolutePath = path.join(UPLOAD_ROOT, storageKey);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, params.buffer);

  try {
    return await prisma.attachment.create({
      data: {
        businessId: params.businessId,
        expenseId: params.expenseId,
        filename: sanitizeFilename(params.filename),
        storageKey,
        mimeType: detectedType,
        sizeBytes: params.buffer.byteLength,
        uploadedByUserId: params.uploadedByUserId,
      },
    });
  } catch (err) {
    // Roll back the file write so a failed DB insert doesn't leave an
    // orphan we can never clean up through the app itself.
    await unlink(absolutePath).catch(() => {});
    throw err;
  }
}

/** Tenant-scoped lookup + file read for a download route. Throws
 * ForbiddenError if the attachment doesn't exist or belongs to a
 * different business — the route handler must call this with a
 * businessId derived from requireMembership, never from the URL alone. */
export async function getAttachmentForDownload(businessId: string, attachmentId: string) {
  const attachment = await prisma.attachment.findFirst({
    where: { id: attachmentId, businessId },
  });
  if (!attachment) throw new ForbiddenError("Attachment not found for this business");

  const absolutePath = path.join(UPLOAD_ROOT, attachment.storageKey);
  let buffer: Buffer;
  try {
    buffer = await readFile(absolutePath);
  } catch (err) {
    logError("attachment file missing on disk", err, { attachmentId, storageKey: attachment.storageKey });
    throw new InvalidFileError("This file is no longer available.");
  }

  return { buffer, mimeType: attachment.mimeType, filename: attachment.filename };
}

export async function deleteAttachment(businessId: string, attachmentId: string) {
  const attachment = await prisma.attachment.findFirst({
    where: { id: attachmentId, businessId },
  });
  if (!attachment) return; // already gone; deletion is idempotent

  await prisma.attachment.delete({ where: { id: attachment.id } });
  await unlink(path.join(UPLOAD_ROOT, attachment.storageKey)).catch(() => {});
}

export async function listAttachmentsForExpense(businessId: string, expenseId: string) {
  return prisma.attachment.findMany({
    where: { businessId, expenseId },
    orderBy: { createdAt: "desc" },
  });
}
