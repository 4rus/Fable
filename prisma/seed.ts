/**
 * Realistic demo data for local development — NOT for production use.
 * Models a small residential/commercial cleaning company (2-person crew,
 * the kind of business the Product Thesis targets) with a mix of prompt
 * and slow-paying customers, recurring costs, and a couple of overdue
 * invoices, so the dashboard actually has something to say.
 *
 * Run with: npm run db:seed
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  await prisma.$transaction([
    prisma.auditLog.deleteMany(),
    prisma.payment.deleteMany(),
    prisma.invoiceLineItem.deleteMany(),
    prisma.invoice.deleteMany(),
    prisma.expense.deleteMany(),
    prisma.category.deleteMany(),
    prisma.customer.deleteMany(),
    prisma.membership.deleteMany(),
    prisma.business.deleteMany(),
    prisma.user.deleteMany(),
  ]);

  const passwordHash = await bcrypt.hash("demo-password-123", 12);
  const user = await prisma.user.create({
    data: { name: "Jordan Reyes", email: "demo@example.com", passwordHash },
  });

  const business = await prisma.business.create({
    data: {
      name: "Clearview Cleaning Co.",
      startingCashCents: 1_420_000, // $14,200
      startingCashAsOf: daysAgo(90),
      memberships: { create: { userId: user.id, role: "OWNER", status: "ACTIVE" } },
    },
  });

  const [sales, supplies, rent, software, payroll, insurance, vehicle] = await Promise.all([
    prisma.category.create({ data: { businessId: business.id, name: "Sales", type: "INCOME", isSystem: true } }),
    prisma.category.create({ data: { businessId: business.id, name: "Supplies", type: "EXPENSE", isSystem: true } }),
    prisma.category.create({ data: { businessId: business.id, name: "Rent", type: "EXPENSE", isSystem: true } }),
    prisma.category.create({ data: { businessId: business.id, name: "Software & Subscriptions", type: "EXPENSE", isSystem: true } }),
    prisma.category.create({ data: { businessId: business.id, name: "Payroll & Contractors", type: "EXPENSE", isSystem: true } }),
    prisma.category.create({ data: { businessId: business.id, name: "Insurance", type: "EXPENSE", isSystem: true } }),
    prisma.category.create({ data: { businessId: business.id, name: "Vehicle & Fuel", type: "EXPENSE", isSystem: true } }),
  ]);
  void sales;

  const customers = await Promise.all(
    [
      { name: "Maple Street Dental", email: "billing@maplestreetdental.example" },
      { name: "Riverside Apartments LLC", email: "ap@riversideapts.example" },
      { name: "Union Coffee Roasters", email: "hello@unioncoffee.example" },
      { name: "Thornwood Law Group", email: "accounts@thornwoodlaw.example" },
      { name: "Fresh Start Daycare", email: "office@freshstartdaycare.example" },
    ].map((c) => prisma.customer.create({ data: { businessId: business.id, ...c } })),
  );
  const [dental, riverside, coffee, law, daycare] = customers;

  // Recurring expenses across the trailing 3 months, so the forecast engine
  // and the expense-trend insight both have real signal.
  for (let m = 3; m >= 1; m--) {
    await prisma.expense.create({
      data: {
        businessId: business.id,
        categoryId: rent.id,
        vendorName: "Downtown Business Park",
        amountCents: 180_000,
        incurredAt: monthsAgo(m),
        isRecurring: true,
        description: "Monthly unit rent",
      },
    });
    await prisma.expense.create({
      data: {
        businessId: business.id,
        categoryId: payroll.id,
        vendorName: "Crew payroll",
        amountCents: 420_000,
        incurredAt: monthsAgo(m),
        isRecurring: true,
      },
    });
    await prisma.expense.create({
      data: {
        businessId: business.id,
        categoryId: software.id,
        vendorName: "Scheduling software",
        amountCents: 7_900,
        incurredAt: monthsAgo(m),
        isRecurring: true,
      },
    });
    await prisma.expense.create({
      data: {
        businessId: business.id,
        categoryId: insurance.id,
        vendorName: "General liability insurance",
        amountCents: 22_500,
        incurredAt: monthsAgo(m),
        isRecurring: true,
      },
    });
  }

  // This month's supply spend is unusually high (18%+ over trailing avg) —
  // gives the expense-trend insight something real to surface.
  await prisma.expense.create({
    data: { businessId: business.id, categoryId: supplies.id, vendorName: "CleanPro Supply Co.", amountCents: 68_000, incurredAt: daysAgo(4) },
  });
  await prisma.expense.create({
    data: { businessId: business.id, categoryId: supplies.id, vendorName: "CleanPro Supply Co.", amountCents: 41_000, incurredAt: daysAgo(12) },
  });
  await prisma.expense.create({
    data: { businessId: business.id, categoryId: vehicle.id, vendorName: "Shell Fuel", amountCents: 26_500, incurredAt: daysAgo(6) },
  });
  for (let m = 1; m <= 3; m++) {
    await prisma.expense.create({
      data: { businessId: business.id, categoryId: supplies.id, vendorName: "CleanPro Supply Co.", amountCents: 32_000, incurredAt: monthsAgo(m) },
    });
  }

  // Invoice 1: paid on time (builds Riverside's on-time payment history)
  await createPaidInvoice(business.id, riverside!.id, 240_000, 45, 40);
  await createPaidInvoice(business.id, riverside!.id, 240_000, 75, 70);

  // Invoice 2: paid, but late (builds a mixed history for Union Coffee)
  await createPaidInvoice(business.id, coffee!.id, 95_000, 40, 20);

  // Invoice 3: overdue and unpaid — the headline "holy shit" moment (this is
  // literally the Product Thesis's own example: a ~$1,840 invoice, 17 days late)
  await createOpenInvoice(business.id, dental!.id, 184_000, -17, "SENT");

  // Invoice 4: partially paid, also overdue
  const partial = await createOpenInvoice(business.id, law!.id, 320_000, -9, "SENT");
  await prisma.payment.create({
    data: {
      businessId: business.id,
      invoiceId: partial.id,
      amountCents: 150_000,
      method: "bank_transfer",
      paidAt: daysAgo(2),
      idempotencyKey: `seed-${partial.id}-1`,
    },
  });
  await prisma.invoice.update({ where: { id: partial.id }, data: { status: "PARTIALLY_PAID" } });

  // Invoice 5: sent recently, not yet due — no anxiety here, just realism
  await createOpenInvoice(business.id, daycare!.id, 128_000, 10, "SENT");

  console.log("Seeded demo business:", business.name);
  console.log("Login: demo@example.com / demo-password-123");
}

async function createPaidInvoice(
  businessId: string,
  customerId: string,
  totalCents: number,
  daysAgoIssued: number,
  daysAgoPaid: number,
) {
  const invoice = await prisma.invoice.create({
    data: {
      businessId,
      customerId,
      number: await nextNumber(businessId),
      issueDate: daysAgo(daysAgoIssued),
      dueDate: daysAgo(daysAgoIssued - 14),
      status: "SENT",
      subtotalCents: totalCents,
      totalCents,
      lineItems: { create: [{ description: "Recurring cleaning service", quantity: 1, unitPriceCents: totalCents, amountCents: totalCents }] },
    },
  });
  await prisma.payment.create({
    data: {
      businessId,
      invoiceId: invoice.id,
      amountCents: totalCents,
      method: "bank_transfer",
      paidAt: daysAgo(daysAgoPaid),
      idempotencyKey: `seed-${invoice.id}-1`,
    },
  });
  return prisma.invoice.update({ where: { id: invoice.id }, data: { status: "PAID" } });
}

async function createOpenInvoice(
  businessId: string,
  customerId: string,
  totalCents: number,
  daysUntilDue: number,
  status: "SENT" | "PARTIALLY_PAID",
) {
  return prisma.invoice.create({
    data: {
      businessId,
      customerId,
      number: await nextNumber(businessId),
      issueDate: daysAgo(14 - daysUntilDue > 0 ? 14 - daysUntilDue : 3),
      dueDate: daysAgo(-daysUntilDue),
      status,
      subtotalCents: totalCents,
      totalCents,
      lineItems: { create: [{ description: "Recurring cleaning service", quantity: 1, unitPriceCents: totalCents, amountCents: totalCents }] },
    },
  });
}

async function nextNumber(businessId: string) {
  const count = await prisma.invoice.count({ where: { businessId } });
  return `INV-${String(count + 1).padStart(4, "0")}`;
}

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000);
}
function monthsAgo(n: number): Date {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return d;
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
