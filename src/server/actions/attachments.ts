"use server";

import { revalidatePath } from "next/cache";
import { requireMembership, ForbiddenError } from "@/server/tenant";
import { uploadAttachment, deleteAttachment, InvalidFileError } from "@/server/services/attachments";
import { logError } from "@/lib/logger";

export type ActionState = { error?: string };

export async function uploadAttachmentAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const businessIdRaw = formData.get("businessId");
  const expenseIdRaw = formData.get("expenseId");
  const file = formData.get("file");

  if (typeof businessIdRaw !== "string" || typeof expenseIdRaw !== "string") {
    return { error: "Invalid request." };
  }
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Please choose a file to upload." };
  }

  const { businessId, userId } = await requireMembership(businessIdRaw);

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    await uploadAttachment({
      businessId,
      expenseId: expenseIdRaw,
      filename: file.name,
      buffer,
      uploadedByUserId: userId,
    });
  } catch (err) {
    if (err instanceof InvalidFileError) return { error: err.message };
    if (err instanceof ForbiddenError) return { error: err.message };
    logError("uploadAttachment failed", err);
    return { error: "Could not upload that file. Please try again." };
  }

  revalidatePath("/app/expenses");
  return {};
}

export async function deleteAttachmentAction(businessId: string, attachmentId: string) {
  const ctx = await requireMembership(businessId);
  await deleteAttachment(ctx.businessId, attachmentId);
  revalidatePath("/app/expenses");
}
