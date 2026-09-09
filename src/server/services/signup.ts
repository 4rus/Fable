import "server-only";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { createBusinessForUser } from "@/server/services/businesses";

export class EmailInUseError extends Error {
  constructor() {
    super("An account with that email already exists");
    this.name = "EmailInUseError";
  }
}

/**
 * Creates a User and their first Business (with an OWNER Membership and
 * starter categories) atomically — the same createBusinessForUser used
 * when an existing user adds a second workspace, run inside this
 * transaction so a failure partway through can't leave an orphaned user
 * with no business.
 */
export async function signUp(params: {
  name: string;
  email: string;
  password: string;
  businessName: string;
  currency?: string;
}) {
  const email = params.email.toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) throw new EmailInUseError();

  const passwordHash = await bcrypt.hash(params.password, 12);

  return prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: { name: params.name, email, passwordHash },
    });
    const business = await createBusinessForUser(user.id, params.businessName, tx, params.currency ?? "USD");
    return { user, business };
  });
}
