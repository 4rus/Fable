import { prisma } from "@/lib/db";

let counter = 0;
function uniqueSuffix() {
  counter += 1;
  return `${Date.now()}-${counter}`;
}

export async function createTestBusiness(name = "Test Business") {
  return prisma.business.create({ data: { name: `${name} ${uniqueSuffix()}` } });
}

export async function createTestUser(email?: string) {
  return prisma.user.create({
    data: {
      name: "Test User",
      email: email ?? `user-${uniqueSuffix()}@example.com`,
      passwordHash: "not-a-real-hash",
    },
  });
}

export async function createTestMembership(userId: string, businessId: string, role: "OWNER" | "MEMBER" = "OWNER") {
  return prisma.membership.create({ data: { userId, businessId, role, status: "ACTIVE" } });
}

export async function createTestCustomer(businessId: string, name = "Test Customer") {
  return prisma.customer.create({ data: { businessId, name: `${name} ${uniqueSuffix()}` } });
}
