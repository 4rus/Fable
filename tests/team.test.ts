import { describe, it, expect } from "vitest";
import { prisma } from "@/lib/db";
import { createTestBusiness, createTestUser, createTestMembership } from "./helpers";
import {
  addMemberByEmail,
  revokeMember,
  listMembers,
  LastOwnerError,
  MemberNotFoundError,
  AlreadyMemberError,
} from "@/server/services/businesses";

describe("addMemberByEmail", () => {
  it("attaches an existing user to the business by email", async () => {
    const owner = await createTestUser();
    const business = await createTestBusiness();
    await createTestMembership(owner.id, business.id, "OWNER");
    const newPerson = await createTestUser("teammate@example.com");

    await addMemberByEmail({
      businessId: business.id,
      email: "teammate@example.com",
      role: "MEMBER",
      invitedByUserId: owner.id,
    });

    const members = await listMembers(business.id);
    expect(members.some((m) => m.userId === newPerson.id && m.role === "MEMBER")).toBe(true);
  });

  it("refuses to add someone with no account rather than pretending to email an invite", async () => {
    const business = await createTestBusiness();
    await expect(
      addMemberByEmail({
        businessId: business.id,
        email: "nobody@example.com",
        role: "MEMBER",
        invitedByUserId: "irrelevant",
      }),
    ).rejects.toThrow(MemberNotFoundError);
  });

  it("refuses to double-add an already-active member", async () => {
    const business = await createTestBusiness();
    const user = await createTestUser("dup@example.com");
    await createTestMembership(user.id, business.id, "MEMBER");

    await expect(
      addMemberByEmail({ businessId: business.id, email: "dup@example.com", role: "MEMBER", invitedByUserId: "x" }),
    ).rejects.toThrow(AlreadyMemberError);
  });

  it("re-activates a previously revoked membership instead of erroring", async () => {
    const business = await createTestBusiness();
    const owner = await createTestUser();
    const user = await createTestUser("comeback@example.com");
    const membership = await createTestMembership(user.id, business.id, "MEMBER");
    await prisma.membership.update({ where: { id: membership.id }, data: { status: "REVOKED", revokedAt: new Date() } });

    const result = await addMemberByEmail({ businessId: business.id, email: "comeback@example.com", role: "OWNER", invitedByUserId: owner.id });
    expect(result.status).toBe("ACTIVE");
    expect(result.role).toBe("OWNER");
  });
});

describe("revokeMember", () => {
  it("marks a membership REVOKED", async () => {
    const business = await createTestBusiness();
    const owner = await createTestUser();
    await createTestMembership(owner.id, business.id, "OWNER");
    const member = await createTestUser();
    const membership = await createTestMembership(member.id, business.id, "MEMBER");

    await revokeMember({ businessId: business.id, membershipId: membership.id, revokedByUserId: owner.id });

    const reloaded = await prisma.membership.findUnique({ where: { id: membership.id } });
    expect(reloaded!.status).toBe("REVOKED");
  });

  it("THE CRITICAL GUARANTEE: refuses to revoke the last remaining active owner", async () => {
    const business = await createTestBusiness();
    const owner = await createTestUser();
    const ownerMembership = await createTestMembership(owner.id, business.id, "OWNER");

    await expect(
      revokeMember({ businessId: business.id, membershipId: ownerMembership.id, revokedByUserId: owner.id }),
    ).rejects.toThrow(LastOwnerError);

    const reloaded = await prisma.membership.findUnique({ where: { id: ownerMembership.id } });
    expect(reloaded!.status).toBe("ACTIVE"); // unchanged
  });

  it("allows revoking one owner when another active owner remains", async () => {
    const business = await createTestBusiness();
    const owner1 = await createTestUser();
    const owner2 = await createTestUser();
    const m1 = await createTestMembership(owner1.id, business.id, "OWNER");
    await createTestMembership(owner2.id, business.id, "OWNER");

    await revokeMember({ businessId: business.id, membershipId: m1.id, revokedByUserId: owner2.id });
    const reloaded = await prisma.membership.findUnique({ where: { id: m1.id } });
    expect(reloaded!.status).toBe("REVOKED");
  });

  it("is idempotent — revoking an already-revoked/nonexistent membership does not throw", async () => {
    const business = await createTestBusiness();
    await expect(
      revokeMember({ businessId: business.id, membershipId: "does-not-exist", revokedByUserId: "x" }),
    ).resolves.toBeUndefined();
  });

  it("THE CRITICAL GUARANTEE under concurrency: two owners revoking each other at the same instant can never leave zero active owners (Phase P)", async () => {
    // Realistic race, not contrived: exactly 2 owners, each revoking the
    // OTHER at the same moment — individually each looks completely fine
    // ("the other owner is still active"), but if both checks read the
    // pre-revoke state before either write commits, both succeed and the
    // business ends up with zero owners: nobody left who can manage
    // billing, add members, or do anything requireOwner() gates.
    const business = await createTestBusiness();
    const owner1 = await createTestUser();
    const owner2 = await createTestUser();
    const m1 = await createTestMembership(owner1.id, business.id, "OWNER");
    const m2 = await createTestMembership(owner2.id, business.id, "OWNER");

    const results = await Promise.allSettled([
      revokeMember({ businessId: business.id, membershipId: m1.id, revokedByUserId: owner2.id }),
      revokeMember({ businessId: business.id, membershipId: m2.id, revokedByUserId: owner1.id }),
    ]);

    // The real, provable invariant: read the actual committed state back,
    // regardless of which promise resolved/rejected which way.
    const remainingActiveOwners = await prisma.membership.count({
      where: { businessId: business.id, role: "OWNER", status: "ACTIVE" },
    });
    expect(remainingActiveOwners).toBeGreaterThanOrEqual(1);

    // Exactly one revoke should have gone through; the other should have
    // been refused as the (now-)last owner.
    const succeeded = results.filter((r) => r.status === "fulfilled");
    const failed = results.filter((r) => r.status === "rejected");
    expect(succeeded.length).toBe(1);
    expect(failed.length).toBe(1);
    if (failed[0]!.status === "rejected") {
      expect(failed[0]!.reason).toBeInstanceOf(LastOwnerError);
    }
  });
});
