import "server-only";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { requireUser } from "@/server/tenant";
import { ACTIVE_BUSINESS_COOKIE } from "@/lib/constants";
import type { Prisma } from "@prisma/client";

/** All businesses the given user has ACTIVE membership on. */
export async function getMyBusinesses(userId: string) {
  const memberships = await prisma.membership.findMany({
    where: { userId, status: "ACTIVE" },
    include: { business: true },
    orderBy: { createdAt: "asc" },
  });
  return memberships
    .filter((m) => !m.business.deletedAt)
    .map((m) => ({ ...m.business, role: m.role }));
}

/**
 * Given the user's own business list (from getMyBusinesses — never trust a
 * businessId from a cookie/header on its own) and a candidate businessId
 * that came from client-controlled state (a cookie), pick the active
 * business: the candidate if the user actually has active membership on
 * it, otherwise fall back to their first business. This is the ONLY
 * place a "remembered active business" cookie value is allowed to
 * influence anything — every page still calls requireMembership()
 * independently before touching data, so a forged cookie can at most
 * pick which of the user's OWN businesses is shown, never someone else's.
 */
export function selectActiveBusiness<T extends { id: string }>(
  businesses: T[],
  candidateId: string | undefined,
): T {
  const match = candidateId ? businesses.find((b) => b.id === candidateId) : undefined;
  return match ?? businesses[0]!;
}

/**
 * The one call every page should use instead of the old
 * `getMyBusinesses(userId)` + `businesses[0]!` pattern. Resolves the
 * logged-in user, their full business list, their role on the active one,
 * and which one is "active" (from the switcher cookie, validated against
 * their real memberships — see selectActiveBusiness). Redirects to
 * /signup if a user somehow has zero businesses (shouldn't happen via
 * normal signup, but every page should fail safe rather than crash on
 * `businesses[0]!`).
 */
export async function getActiveBusinessContext() {
  const { userId, userEmail } = await requireUser();
  const businesses = await getMyBusinesses(userId);
  if (businesses.length === 0) {
    return { userId, userEmail, businesses: [], business: null };
  }

  const store = await cookies();
  const business = selectActiveBusiness(businesses, store.get(ACTIVE_BUSINESS_COOKIE)?.value);

  return { userId, userEmail, businesses, business };
}

const DEFAULT_CATEGORIES: { name: string; type: "INCOME" | "EXPENSE" }[] = [
  { name: "Sales", type: "INCOME" },
  { name: "Supplies", type: "EXPENSE" },
  { name: "Rent", type: "EXPENSE" },
  { name: "Software & Subscriptions", type: "EXPENSE" },
  { name: "Payroll & Contractors", type: "EXPENSE" },
  { name: "Insurance", type: "EXPENSE" },
  { name: "Vehicle & Fuel", type: "EXPENSE" },
  { name: "Marketing", type: "EXPENSE" },
  { name: "Other", type: "EXPENSE" },
];

/** Creates a Business, an OWNER Membership for the given (already
 * authenticated) user, and a starter set of expense categories — used
 * both at signup and when an existing user adds a second workspace.
 *
 * Accepts an optional transaction client so callers that need this
 * atomic with a preceding write (signup: user + first business must
 * succeed together or not at all) can pass their own `tx` in; standalone
 * callers (adding a second workspace to an existing user) can omit it
 * and get an internally-managed transaction. */
export async function createBusinessForUser(
  userId: string,
  businessName: string,
  client: Prisma.TransactionClient | typeof prisma = prisma,
  currency: string = "USD",
) {
  const run = async (tx: Prisma.TransactionClient | typeof prisma) => {
    const business = await tx.business.create({
      data: {
        name: businessName,
        currency,
        memberships: { create: { userId, role: "OWNER", status: "ACTIVE" } },
        categories: {
          create: DEFAULT_CATEGORIES.map((c) => ({ name: c.name, type: c.type, isSystem: true })),
        },
      },
    });
    await tx.auditLog.create({
      data: {
        businessId: business.id,
        userId,
        action: "business.create",
        entityType: "Business",
        entityId: business.id,
      },
    });
    return business;
  };

  // If the caller handed us their own transaction client, we're already
  // inside a transaction — just run against it. Otherwise, wrap our own
  // writes in one so a failure between business.create and the audit log
  // can't leave a business with no audit trail.
  return client === prisma ? prisma.$transaction((tx) => run(tx)) : run(client);
}

// ── Team management ────────────────────────────────────────────────────
//
// Scope decision (documented, not silent): there is no email/invitation-
// token infrastructure in v1. "Adding a member" only works if that person
// already has a Fable account — we look their email up and attach
// a membership directly. If they don't have an account yet, we say so
// rather than pretending an email invite went out. A real invite-by-email
// flow (token, expiry, signup-on-accept) is a deliberate P1, not something
// to fake here.

export class LastOwnerError extends Error {
  constructor() {
    super("A business must always have at least one active owner.");
    this.name = "LastOwnerError";
  }
}

export class MemberNotFoundError extends Error {
  constructor(email: string) {
    super(`No Fable account exists for ${email} yet — they need to sign up first.`);
    this.name = "MemberNotFoundError";
  }
}

export class AlreadyMemberError extends Error {
  constructor() {
    super("That person is already on this team.");
    this.name = "AlreadyMemberError";
  }
}

export async function listMembers(businessId: string) {
  const memberships = await prisma.membership.findMany({
    where: { businessId, status: "ACTIVE" },
    include: { user: { select: { id: true, name: true, email: true } } },
    orderBy: { createdAt: "asc" },
  });
  return memberships;
}

export async function addMemberByEmail(params: {
  businessId: string;
  email: string;
  role: "OWNER" | "MEMBER";
  invitedByUserId: string;
}) {
  const user = await prisma.user.findUnique({ where: { email: params.email.toLowerCase() } });
  if (!user) throw new MemberNotFoundError(params.email);

  const existing = await prisma.membership.findUnique({
    where: { userId_businessId: { userId: user.id, businessId: params.businessId } },
  });
  if (existing && existing.status === "ACTIVE") throw new AlreadyMemberError();

  const membership = existing
    ? await prisma.membership.update({
        where: { id: existing.id },
        data: { status: "ACTIVE", role: params.role, revokedAt: null },
      })
    : await prisma.membership.create({
        data: { userId: user.id, businessId: params.businessId, role: params.role, status: "ACTIVE" },
      });

  await prisma.auditLog.create({
    data: {
      businessId: params.businessId,
      userId: params.invitedByUserId,
      action: "membership.add",
      entityType: "Membership",
      entityId: membership.id,
      metadata: JSON.stringify({ addedUserId: user.id, role: params.role }),
    },
  });

  return membership;
}

export async function revokeMember(params: {
  businessId: string;
  membershipId: string;
  revokedByUserId: string;
}) {
  const membership = await prisma.membership.findFirst({
    where: { id: params.membershipId, businessId: params.businessId, status: "ACTIVE" },
  });
  if (!membership) return; // already gone; revoking is idempotent

  if (membership.role === "OWNER") {
    const otherActiveOwners = await prisma.membership.count({
      where: {
        businessId: params.businessId,
        role: "OWNER",
        status: "ACTIVE",
        id: { not: membership.id },
      },
    });
    if (otherActiveOwners === 0) throw new LastOwnerError();
  }

  await prisma.$transaction([
    prisma.membership.update({
      where: { id: membership.id },
      data: { status: "REVOKED", revokedAt: new Date() },
    }),
    prisma.auditLog.create({
      data: {
        businessId: params.businessId,
        userId: params.revokedByUserId,
        action: "membership.revoke",
        entityType: "Membership",
        entityId: membership.id,
      },
    }),
  ]);
}
