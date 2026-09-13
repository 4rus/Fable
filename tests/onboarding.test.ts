import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { createTestBusiness, createTestUser, createTestMembership, createTestCustomer } from "./helpers";
import { getOnboardingStatus, confirmStartingCash } from "@/server/services/onboarding";
import { createInvoice } from "@/server/services/invoices";
import { ForbiddenError } from "@/server/tenant";

// skipOnboardingAction/confirmStartingCashAction go through
// requireMembership/requireOwner, which call getServerSession internally
// — same mocking approach as tests/tenant-isolation.test.ts.
vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
import { getServerSession } from "next-auth";
import { skipOnboardingAction, confirmStartingCashAction } from "@/server/actions/onboarding";

function mockSessionAs(userId: string | null, email = "test@example.com") {
  (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
    userId ? { user: { id: userId, email } } : null,
  );
}

beforeEach(() => vi.clearAllMocks());

describe("getOnboardingStatus", () => {
  it("is incomplete for a brand-new business with all four steps outstanding", async () => {
    const business = await createTestBusiness();
    const status = await getOnboardingStatus(business.id);

    expect(status.isComplete).toBe(false);
    expect(status.bankConnected).toBe(false);
    expect(status.hasCustomer).toBe(false);
    expect(status.hasInvoice).toBe(false);
    expect(status.hasExpense).toBe(false);
    expect(status.startingCashConfirmed).toBe(false);
    expect(status.steps.map((s) => s.id)).toEqual(["bank", "startingCash", "customerAndInvoice", "expense"]);
  });

  it("is complete once a real invoice exists, with that step dropped from the list", async () => {
    const business = await createTestBusiness();
    const customer = await createTestCustomer(business.id);
    await createInvoice({
      businessId: business.id,
      customerId: customer.id,
      issueDate: new Date(),
      dueDate: new Date(Date.now() + 86_400_000 * 14),
      taxCents: 0,
      lineItems: [{ description: "Work", quantity: 1, unitPriceCents: 5000 }],
    });

    const status = await getOnboardingStatus(business.id);
    expect(status.isComplete).toBe(true);
    expect(status.hasInvoice).toBe(true);
    expect(status.steps.find((s) => s.id === "customerAndInvoice")).toBeUndefined();
    // Still outstanding: bank, starting cash, expense.
    expect(status.steps.map((s) => s.id)).toEqual(["bank", "startingCash", "expense"]);
  });

  it("a customer with no invoice yet does NOT complete onboarding or clear the customerAndInvoice step", async () => {
    const business = await createTestBusiness();
    await createTestCustomer(business.id);

    const status = await getOnboardingStatus(business.id);
    expect(status.isComplete).toBe(false);
    expect(status.hasCustomer).toBe(true);
    expect(status.hasInvoice).toBe(false);
    expect(status.steps.find((s) => s.id === "customerAndInvoice")).toBeDefined();
  });

  it("tenant isolation: one business's data never marks another business's onboarding complete", async () => {
    const businessA = await createTestBusiness();
    const businessB = await createTestBusiness();
    const customer = await createTestCustomer(businessA.id);
    await createInvoice({
      businessId: businessA.id,
      customerId: customer.id,
      issueDate: new Date(),
      dueDate: new Date(Date.now() + 86_400_000),
      taxCents: 0,
      lineItems: [{ description: "x", quantity: 1, unitPriceCents: 1000 }],
    });

    const statusA = await getOnboardingStatus(businessA.id);
    const statusB = await getOnboardingStatus(businessB.id);
    expect(statusA.isComplete).toBe(true);
    expect(statusB.isComplete).toBe(false);
  });
});

describe("skipOnboardingAction", () => {
  it("marks onboardingSkippedAt and makes isComplete true with no other data", async () => {
    const business = await createTestBusiness();
    const user = await createTestUser();
    await createTestMembership(user.id, business.id);
    mockSessionAs(user.id);

    await expect(skipOnboardingAction(business.id)).rejects.toBeTruthy(); // redirect() throws by design

    const reloaded = await prisma.business.findUniqueOrThrow({ where: { id: business.id } });
    expect(reloaded.onboardingSkippedAt).not.toBeNull();

    const status = await getOnboardingStatus(business.id);
    expect(status.isComplete).toBe(true);
    expect(status.skipped).toBe(true);
    // Skipping doesn't fake-complete the individual steps.
    expect(status.steps.map((s) => s.id)).toEqual(["bank", "startingCash", "customerAndInvoice", "expense"]);
  });

  it("cannot be called for a business the caller isn't a member of (tenant isolation)", async () => {
    const business = await createTestBusiness();
    const user = await createTestUser();
    mockSessionAs(user.id); // real, authenticated user — just not a member of this business
    await expect(skipOnboardingAction(business.id)).rejects.toThrow(ForbiddenError);
  });
});

describe("confirmStartingCash (service)", () => {
  it("sets startingCashCents/startingCashAsOf/startingCashConfirmedAt", async () => {
    const business = await createTestBusiness();

    await confirmStartingCash(business.id, 125050, new Date("2026-01-01"));

    const reloaded = await prisma.business.findUniqueOrThrow({ where: { id: business.id } });
    expect(reloaded.startingCashCents).toBe(125050);
    expect(reloaded.startingCashAsOf.toISOString().slice(0, 10)).toBe("2026-01-01");
    expect(reloaded.startingCashConfirmedAt).not.toBeNull();

    const status = await getOnboardingStatus(business.id);
    expect(status.startingCashConfirmed).toBe(true);
    expect(status.steps.find((s) => s.id === "startingCash")).toBeUndefined();
  });

  it("accepts an explicit $0 balance as confirmed (distinct from never having set one)", async () => {
    const business = await createTestBusiness();

    await confirmStartingCash(business.id, 0, new Date("2026-01-01"));

    const status = await getOnboardingStatus(business.id);
    expect(status.startingCashConfirmed).toBe(true);
  });
});

describe("confirmStartingCashAction", () => {
  function formData(amount: string, asOfDate: string) {
    const fd = new FormData();
    fd.set("amount", amount);
    fd.set("asOfDate", asOfDate);
    return fd;
  }

  it("rejects a non-owner member", async () => {
    const business = await createTestBusiness();
    const user = await createTestUser();
    await createTestMembership(user.id, business.id, "MEMBER");
    mockSessionAs(user.id);

    await expect(
      confirmStartingCashAction(business.id, {}, formData("100", "2026-01-01")),
    ).rejects.toThrow(ForbiddenError);
  });

  it("rejects an invalid dollar amount without touching the database", async () => {
    const business = await createTestBusiness();
    const user = await createTestUser();
    await createTestMembership(user.id, business.id, "OWNER");
    mockSessionAs(user.id);

    const result = await confirmStartingCashAction(business.id, {}, formData("not-a-number", "2026-01-01"));
    expect(result.error).toBeTruthy();

    const reloaded = await prisma.business.findUniqueOrThrow({ where: { id: business.id } });
    expect(reloaded.startingCashConfirmedAt).toBeNull();
  });
});
