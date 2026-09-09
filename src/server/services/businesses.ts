import "server-only";
import { prisma } from "@/lib/db";

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
