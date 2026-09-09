"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireOwner, ForbiddenError } from "@/server/tenant";
import {
  addMemberByEmail,
  revokeMember,
  LastOwnerError,
  MemberNotFoundError,
  AlreadyMemberError,
} from "@/server/services/businesses";

export type ActionState = { error?: string };

const addMemberSchema = z.object({
  businessId: z.string().min(1),
  email: z.string().trim().toLowerCase().email(),
  role: z.enum(["OWNER", "MEMBER"]),
});

export async function addMemberAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = addMemberSchema.safeParse({
    businessId: formData.get("businessId"),
    email: formData.get("email"),
    role: formData.get("role"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  // Only an OWNER may add members — enforced here, not just hidden in the UI.
  const { businessId, userId } = await requireOwner(parsed.data.businessId);

  try {
    await addMemberByEmail({ businessId, email: parsed.data.email, role: parsed.data.role, invitedByUserId: userId });
  } catch (err) {
    if (err instanceof MemberNotFoundError || err instanceof AlreadyMemberError) {
      return { error: err.message };
    }
    if (err instanceof ForbiddenError) return { error: err.message };
    console.error("addMember failed", err);
    return { error: "Could not add that person. Please try again." };
  }

  revalidatePath("/app/settings/team");
  return {};
}

export async function revokeMemberAction(
  businessId: string,
  membershipId: string,
): Promise<ActionState> {
  const { userId } = await requireOwner(businessId);
  try {
    await revokeMember({ businessId, membershipId, revokedByUserId: userId });
  } catch (err) {
    if (err instanceof LastOwnerError) return { error: err.message };
    console.error("revokeMember failed", err);
    return { error: "Could not remove that person. Please try again." };
  }
  revalidatePath("/app/settings/team");
  return {};
}
