import "server-only";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";

/**
 * THE SINGLE CHOKEPOINT FOR MULTI-TENANT AUTHORIZATION.
 *
 * Every server action / route handler that touches business-owned data
 * MUST call one of these two functions and use the `businessId` IT RETURNS
 * — never the businessId a client sent in a form field, query string, or
 * URL segment, except as the *candidate* to check membership against.
 *
 * Chain enforced: authenticated session -> active Membership row ->
 * businessId. If that chain breaks anywhere, we throw, and callers must not
 * swallow the error into a generic empty result — an authorization failure
 * should be loud in logs, even though the user just sees "not found".
 */

export class UnauthenticatedError extends Error {
  constructor() {
    super("Not authenticated");
    this.name = "UnauthenticatedError";
  }
}

export class ForbiddenError extends Error {
  constructor(message = "Not authorized for this business") {
    super(message);
    this.name = "ForbiddenError";
  }
}

export interface AuthedContext {
  userId: string;
  userEmail: string;
}

/** Confirms there is a logged-in user. Does NOT check any business access. */
export async function requireUser(): Promise<AuthedContext> {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId || !session?.user?.email) {
    throw new UnauthenticatedError();
  }
  return { userId, userEmail: session.user.email };
}

/**
 * Confirms the current user has an ACTIVE membership on `businessId` and
 * returns the membership (with role) alongside the auth context. This is
 * the call every invoice/payment/expense/customer action starts with.
 *
 * `businessId` here is the value the client is ASKING to access — treat it
 * as unauthenticated input. This function is what turns it into something
 * safe to query with.
 */
export async function requireMembership(businessId: string) {
  if (!businessId || typeof businessId !== "string") {
    throw new ForbiddenError("Missing or invalid business id");
  }
  const { userId, userEmail } = await requireUser();

  const membership = await prisma.membership.findUnique({
    where: { userId_businessId: { userId, businessId } },
  });

  if (!membership || membership.status !== "ACTIVE") {
    // Same error whether the business doesn't exist, the user was never a
    // member, or membership was revoked — don't leak which case it is.
    throw new ForbiddenError();
  }

  return { userId, userEmail, businessId, role: membership.role, membership };
}

/** Convenience for actions that require the OWNER role specifically
 * (e.g. revoking another member, deleting the business). */
export async function requireOwner(businessId: string) {
  const ctx = await requireMembership(businessId);
  if (ctx.role !== "OWNER") {
    throw new ForbiddenError("Owner role required");
  }
  return ctx;
}
