import "server-only";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";

export class EmailInUseError extends Error {
  constructor() {
    super("An account with that email already exists");
    this.name = "EmailInUseError";
  }
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

/**
 * Creates a User, their first Business, an OWNER Membership linking them,
 * and a starter set of expense categories — all inside one transaction so
 * we never end up with a half-created account.
 */
export async function signUp(params: {
  name: string;
  email: string;
  password: string;
  businessName: string;
}) {
  const email = params.email.toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) throw new EmailInUseError();

  const passwordHash = await bcrypt.hash(params.password, 12);

  return prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: { name: params.name, email, passwordHash },
    });
    const business = await tx.business.create({
      data: {
        name: params.businessName,
        memberships: { create: { userId: user.id, role: "OWNER", status: "ACTIVE" } },
        categories: {
          create: DEFAULT_CATEGORIES.map((c) => ({ name: c.name, type: c.type, isSystem: true })),
        },
      },
    });
    await tx.auditLog.create({
      data: {
        businessId: business.id,
        userId: user.id,
        action: "business.create",
        entityType: "Business",
        entityId: business.id,
      },
    });
    return { user, business };
  });
}
