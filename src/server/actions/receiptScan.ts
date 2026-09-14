"use server";

import { requireMembership } from "@/server/tenant";
import { scanReceiptImage, type ReceiptScanResult } from "@/server/services/receiptScan";

/**
 * Called directly from the client (not via useActionState — this isn't a
 * form submission, it fires when a file is chosen so the visible expense
 * fields can be pre-filled before the user reviews and saves). Returns a
 * draft only; scanReceiptImage never writes anything to the database.
 */
export async function scanReceiptAction(formData: FormData): Promise<ReceiptScanResult> {
  const businessIdRaw = formData.get("businessId");
  const file = formData.get("file");

  if (typeof businessIdRaw !== "string") {
    return { ok: false, reason: "invalid_file", message: "Invalid request." };
  }
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, reason: "invalid_file", message: "Please choose a receipt photo." };
  }

  const { businessId } = await requireMembership(businessIdRaw);
  const buffer = Buffer.from(await file.arrayBuffer());
  return scanReceiptImage(businessId, buffer);
}
