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
