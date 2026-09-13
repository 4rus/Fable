import "server-only";
import { prisma } from "@/lib/db";
import { addCents, multiplyCentsByQuantity, formatCents } from "@/lib/money";
import type { Prisma } from "@prisma/client";
import { ForbiddenError } from "@/server/tenant";

/**
 * TRUST-CRITICAL MODULE. This is where invoice totals and payment
 * application happen. Rules enforced here, not in the UI:
 *
 *  1. Line item amounts and invoice totals are ALWAYS recomputed
 *     server-side from unitPriceCents * quantity — a client-sent
 *     amountCents/subtotalCents/totalCents is never trusted.
 *  2. An invoice can never accept more in payments than its totalCents
 *     (no silent overpayment).
 *  3. invoice.status is a cache, recomputed from the sum of non-voided
 *     payments inside the same DB transaction as the write that could
 *     have changed it, so it can never drift from reality.
 *  4. Every payment write carries an idempotencyKey with a unique
 *     constraint — a retried request cannot record the same money twice.
 */

export class OverpaymentError extends Error {
  constructor(amountCents: number, remainingCents: number) {
    super(
      `That payment of ${formatCents(amountCents)} is more than the ${formatCents(remainingCents)} remaining on this invoice.`,
    );
    this.name = "OverpaymentError";
  }
}

export class InvalidInvoiceStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidInvoiceStateError";
  }
}

interface LineItemInput {
  description: string;
  quantity: number;
  unitPriceCents: number;
}

export async function createInvoice(params: {
  businessId: string;
  customerId: string;
  issueDate: Date;
  dueDate: Date;
  taxCents: number;
  notes?: string;
  lineItems: LineItemInput[];
}) {
  // Tenant check baked directly into the query, not just at the caller:
  // a customerId belonging to a DIFFERENT business must fail here even if
  // someone forgets to check membership upstream.
  const customer = await prisma.customer.findFirst({
    where: { id: params.customerId, businessId: params.businessId, deletedAt: null },
    select: { id: true },
  });
  if (!customer) {
    throw new ForbiddenError("Customer does not belong to this business");
  }

  const computedLines = params.lineItems.map((li) => ({
    description: li.description,
    quantity: li.quantity,
    unitPriceCents: li.unitPriceCents,
    amountCents: multiplyCentsByQuantity(li.unitPriceCents, li.quantity),
  }));
  const subtotalCents = addCents(...computedLines.map((l) => l.amountCents));
  const totalCents = addCents(subtotalCents, params.taxCents);

  return prisma.$transaction(async (tx) => {
    const number = await nextInvoiceNumber(tx, params.businessId);
    return tx.invoice.create({
      data: {
        businessId: params.businessId,
        customerId: params.customerId,
        number,
        issueDate: params.issueDate,
        dueDate: params.dueDate,
        status: "DRAFT",
        subtotalCents,
        taxCents: params.taxCents,
        totalCents,
        notes: params.notes,
        lineItems: { create: computedLines },
      },
      include: { lineItems: true, customer: true },
    });
  });
}

async function nextInvoiceNumber(tx: Prisma.TransactionClient, businessId: string) {
  const last = await tx.invoice.findFirst({
    where: { businessId },
    orderBy: { createdAt: "desc" },
    select: { number: true },
  });
  const lastN = last ? parseInt(last.number.replace(/\D/g, ""), 10) || 0 : 0;
  return `INV-${String(lastN + 1).padStart(4, "0")}`;
}

export async function markInvoiceSent(businessId: string, invoiceId: string) {
  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId, businessId, deletedAt: null },
  });
  if (!invoice) throw new ForbiddenError("Invoice not found for this business");
  if (invoice.status !== "DRAFT") {
    throw new InvalidInvoiceStateError(`Cannot send an invoice in status ${invoice.status}`);
  }
  return prisma.invoice.update({ where: { id: invoiceId }, data: { status: "SENT" } });
}

export async function recordPayment(params: {
  businessId: string;
  invoiceId: string;
  amountCents: number;
  method: string;
  paidAt: Date;
  note?: string;
  idempotencyKey: string;
}) {
  return prisma.$transaction(async (tx) => {
    // Idempotency check first: if this exact payment attempt already
    // succeeded, return the existing result instead of creating a duplicate.
    const existing = await tx.payment.findUnique({
      where: { idempotencyKey: params.idempotencyKey },
      include: { invoice: { include: { payments: true, lineItems: true, customer: true } } },
    });
    if (existing) {
      // Same idempotency key reused for a different invoice/business, OR
      // a different amount on the same invoice, is a client bug (or an
      // attack) — not a legitimate retry, which resubmits the identical
      // request. Reject loudly rather than silently returning the
      // original payment's result: without the amount check (Phase P —
      // found by deliberately trying this), a caller expecting their
      // *new* amount to be recorded would instead get a quiet, wrong
      // "success" for the *old* one, with no error to reveal the
      // mismatch ever happened.
      if (
        existing.businessId !== params.businessId ||
        existing.invoiceId !== params.invoiceId ||
        existing.amountCents !== params.amountCents
      ) {
        throw new ForbiddenError("Idempotency key does not match the original request");
      }
      return existing.invoice;
    }

    // Row lock BEFORE reading the invoice/its payments (Phase P): two
    // concurrent recordPayment calls on the same invoice, each
    // individually valid, could otherwise both pass the overpayment
    // check below before either had committed, together overpaying the
    // invoice — confirmed as a real, reproducible bug with a genuine
    // concurrent-payment test (tests/invoices.test.ts), not a
    // theoretical one, before this fix existed.
    // `SELECT ... FOR UPDATE` makes a second concurrent transaction on
    // the same invoice id block here until the first one commits or rolls
    // back, so its own read of `payments` below is guaranteed to see
    // whatever the first transaction just wrote — turning this
    // check-then-write into something actually safe under concurrency,
    // not just under sequential calls. Scoped to this one invoice row
    // only; unrelated invoices/businesses are completely unaffected and
    // never contend with each other.
    await tx.$queryRaw`SELECT id FROM "invoices" WHERE id = ${params.invoiceId} FOR UPDATE`;

    // Tenant + existence check scoped to businessId, not just invoiceId.
    const invoice = await tx.invoice.findFirst({
      where: { id: params.invoiceId, businessId: params.businessId, deletedAt: null },
      include: { payments: { where: { voidedAt: null } } },
    });
    if (!invoice) throw new ForbiddenError("Invoice not found for this business");
    if (invoice.status === "DRAFT" || invoice.status === "VOID") {
      throw new InvalidInvoiceStateError(
        `Cannot record a payment against an invoice in status ${invoice.status}`,
      );
    }

    const alreadyPaidCents = addCents(...invoice.payments.map((p) => p.amountCents));
    const remainingCents = invoice.totalCents - alreadyPaidCents;
    if (params.amountCents > remainingCents) {
      throw new OverpaymentError(params.amountCents, remainingCents);
    }

    await tx.payment.create({
      data: {
        businessId: params.businessId,
        invoiceId: params.invoiceId,
        amountCents: params.amountCents,
        method: params.method,
        paidAt: params.paidAt,
        note: params.note,
        idempotencyKey: params.idempotencyKey,
      },
    });

    const newPaidCents = addCents(alreadyPaidCents, params.amountCents);
    const newStatus = newPaidCents >= invoice.totalCents ? "PAID" : "PARTIALLY_PAID";

    const updated = await tx.invoice.update({
      where: { id: params.invoiceId },
      data: { status: newStatus },
      include: { payments: true, lineItems: true, customer: true },
    });

    await tx.auditLog.create({
      data: {
        businessId: params.businessId,
        action: "payment.record",
        entityType: "Invoice",
        entityId: params.invoiceId,
        metadata: JSON.stringify({ amountCents: params.amountCents, newStatus }),
      },
    });

    return updated;
  });
}

/** True "overdue" is never stored — it's derived at read time so it can
 * never go stale relative to today's date. */
export function isOverdue(invoice: { status: string; dueDate: Date }, now = new Date()): boolean {
  return (
    (invoice.status === "SENT" || invoice.status === "PARTIALLY_PAID") && invoice.dueDate < now
  );
}

export function amountPaidCents(invoice: { payments: { amountCents: number; voidedAt: Date | null }[] }): number {
  return addCents(...invoice.payments.filter((p) => !p.voidedAt).map((p) => p.amountCents));
}

export function balanceDueCents(invoice: {
  totalCents: number;
  payments: { amountCents: number; voidedAt: Date | null }[];
}): number {
  return invoice.totalCents - amountPaidCents(invoice);
}
