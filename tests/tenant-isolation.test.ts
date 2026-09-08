import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { createTestBusiness, createTestUser, createTestMembership } from "./helpers";

// requireMembership/requireUser call getServerSession internally. We mock
// that boundary so these tests exercise the real authorization logic
// (membership lookup, status check, role check) against a real database,
// without needing a real HTTP session.
vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
import { getServerSession } from "next-auth";
import { requireMembership, requireOwner, ForbiddenError, UnauthenticatedError } from "@/server/tenant";

function mockSessionAs(userId: string | null, email = "test@example.com") {
  (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
    userId ? { user: { id: userId, email } } : null,
  );
}

describe("tenant isolation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws UnauthenticatedError when there is no session", async () => {
    mockSessionAs(null);
    const business = await createTestBusiness();
    await expect(requireMembership(business.id)).rejects.toThrow(UnauthenticatedError);
  });

  it("throws ForbiddenError for a real user who is not a member of the business", async () => {
    const userA = await createTestUser();
    const businessB = await createTestBusiness(); // userA has no membership here
    mockSessionAs(userA.id);
    await expect(requireMembership(businessB.id)).rejects.toThrow(ForbiddenError);
  });

  it("THE CORE GUARANTEE: User A cannot access Business B's data even knowing its real ID", async () => {
    const userA = await createTestUser();
    const businessA = await createTestBusiness();
    await createTestMembership(userA.id, businessA.id);

    const businessB = await createTestBusiness(); // a completely different tenant

    mockSessionAs(userA.id);
    // userA is a legitimate, active member of businessA...
    await expect(requireMembership(businessA.id)).resolves.toMatchObject({ businessId: businessA.id });
    // ...but has zero access to businessB, despite having a valid session
    // and knowing businessB's real database id.
    await expect(requireMembership(businessB.id)).rejects.toThrow(ForbiddenError);
  });

  it("denies access once membership is revoked", async () => {
    const user = await createTestUser();
    const business = await createTestBusiness();
    const membership = await createTestMembership(user.id, business.id);
    await prisma.membership.update({
      where: { id: membership.id },
      data: { status: "REVOKED", revokedAt: new Date() },
    });

    mockSessionAs(user.id);
    await expect(requireMembership(business.id)).rejects.toThrow(ForbiddenError);
  });

  it("enforces owner-only actions against a non-owner member", async () => {
    const user = await createTestUser();
    const business = await createTestBusiness();
    await createTestMembership(user.id, business.id, "MEMBER");

    mockSessionAs(user.id);
    await expect(requireOwner(business.id)).rejects.toThrow(ForbiddenError);
  });

  it("allows owner-only actions for an actual owner", async () => {
    const user = await createTestUser();
    const business = await createTestBusiness();
    await createTestMembership(user.id, business.id, "OWNER");

    mockSessionAs(user.id);
    await expect(requireOwner(business.id)).resolves.toMatchObject({ role: "OWNER" });
  });

  it("rejects a missing/empty businessId outright rather than querying with it", async () => {
    const user = await createTestUser();
    mockSessionAs(user.id);
    await expect(requireMembership("")).rejects.toThrow(ForbiddenError);
  });
});
