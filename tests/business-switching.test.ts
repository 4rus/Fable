import { describe, it, expect } from "vitest";
import { prisma } from "@/lib/db";
import { createTestUser } from "./helpers";
import { selectActiveBusiness, createBusinessForUser, getMyBusinesses } from "@/server/services/businesses";

describe("selectActiveBusiness", () => {
  const businesses = [{ id: "a" }, { id: "b" }, { id: "c" }];

  it("picks the candidate when it's in the list", () => {
    expect(selectActiveBusiness(businesses, "b").id).toBe("b");
  });

  it("falls back to the first business when there's no candidate", () => {
    expect(selectActiveBusiness(businesses, undefined).id).toBe("a");
  });

  it("falls back to the first business when the candidate isn't one of the user's own — this is the security-relevant case: a forged/stale cookie value naming a business that isn't in the caller's own list must never be trusted", () => {
    expect(selectActiveBusiness(businesses, "someone-elses-business-id").id).toBe("a");
  });
});

describe("createBusinessForUser", () => {
  it("creates a second business for an existing user, with its own OWNER membership and starter categories", async () => {
    const user = await createTestUser();
    const firstBusiness = await createBusinessForUser(user.id, "First Shop");
    const secondBusiness = await createBusinessForUser(user.id, "Second Shop");

    expect(firstBusiness.id).not.toBe(secondBusiness.id);

    const myBusinesses = await getMyBusinesses(user.id);
    const names = myBusinesses.map((b) => b.name).sort();
    expect(names).toEqual(["First Shop", "Second Shop"]);

    const categories = await prisma.category.findMany({ where: { businessId: secondBusiness.id } });
    expect(categories.length).toBeGreaterThan(0);

    const membership = await prisma.membership.findUnique({
      where: { userId_businessId: { userId: user.id, businessId: secondBusiness.id } },
    });
    expect(membership?.role).toBe("OWNER");
    expect(membership?.status).toBe("ACTIVE");
  });

  it("writes an audit log entry for the new business", async () => {
    const user = await createTestUser();
    const business = await createBusinessForUser(user.id, "Audited Shop");
    const log = await prisma.auditLog.findFirst({
      where: { businessId: business.id, action: "business.create" },
    });
    expect(log).not.toBeNull();
    expect(log!.userId).toBe(user.id);
  });
});
