import "server-only";
import { prisma } from "@/lib/db";
import { ForbiddenError } from "@/server/tenant";
import { formatCents } from "@/lib/money";
import { sendEmail, type SendEmailResult } from "@/lib/email";
import { balanceDueCents, isOverdue } from "@/server/services/invoices";
import { MissingCustomerEmailError } from "@/server/services/invoiceEmail";

/**
 * PAYMENT REMINDERS (Phase K — workflows tied to insights). A real email
 * sent through the same src/lib/email.ts path as the invoice send/CSV
 * flows — never a fake "reminder sent" confirmation. Distinct from
 * sendInvoiceEmail (invoiceEmail.ts): a reminder never attaches the PDF or
 * touches invoice status, and only ever makes sense on an invoice that's
 * already SENT/PARTIALLY_PAID with a real balance outstanding.
 */

export class ReminderNotSendableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReminderNotSendableError";
  }
}

/** A courtesy limit, not a security control: stops an eager double-click
 * or a "send reminder" quick-action being clicked twice in a row from
 * nagging the customer twice in one day. Nothing about invoice status or
 * money enforces this — see Invoice.lastReminderSentAt. */
const REMINDER_COOLDOWN_MS = 24 * 60 * 60 * 1000;

export class ReminderRateLimitedError extends Error {
  constructor(nextEligibleAt: Date) {
    super(
      `A reminder for this invoice already went out recently. You can send another after ${nextEligibleAt.toLocaleString()}.`,
    );
    this.name = "ReminderRateLimitedError";
  }
}

export type SendReminderResult =
  | { delivered: true }
  | { delivered: false; reason: "not_configured" }
  | { delivered: false; reason: "send_failed"; message: string };

export async function sendInvoiceReminderEmail(businessId: string, invoiceId: string): Promise<SendReminderResult> {
  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId, businessId, deletedAt: null },
    include: { customer: true, payments: { where: { voidedAt: null } }, business: true },
  });
  if (!invoice) throw new ForbiddenError("Invoice not found for this business");

  if (invoice.status !== "SENT" && invoice.status !== "PARTIALLY_PAID") {
    throw new ReminderNotSendableError(
      invoice.status === "DRAFT"
        ? "Send this invoice first before sending a reminder."
        : invoice.status === "PAID"
          ? "This invoice is already paid — there's nothing to remind the customer about."
          : "This invoice has been voided and can't be reminded about.",
    );
  }

  const dueCents = balanceDueCents(invoice);
  if (dueCents <= 0) {
    // Shouldn't happen given the status guard above (status is a cache
    // recomputed from payments — see invoices.ts), but money math is
    // never trusted transitively; check the real number too.
    throw new ReminderNotSendableError("This invoice has no balance remaining.");
  }

  if (!invoice.customer.email) {
    throw new MissingCustomerEmailError();
  }

  if (invoice.lastReminderSentAt) {
    const nextEligibleAt = new Date(invoice.lastReminderSentAt.getTime() + REMINDER_COOLDOWN_MS);
    if (nextEligibleAt > new Date()) {
      throw new ReminderRateLimitedError(nextEligibleAt);
    }
  }

  const dueFormatted = invoice.dueDate.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const overdue = isOverdue(invoice);
  const daysLate = overdue ? Math.floor((Date.now() - invoice.dueDate.getTime()) / (24 * 60 * 60 * 1000)) : 0;
  const dueCentsFormatted = formatCents(dueCents, invoice.business.currency);

  const situationLine = overdue
    ? `Invoice ${invoice.number} was due ${dueFormatted} and is now ${daysLate} day${daysLate === 1 ? "" : "s"} past due.`
    : `This is a friendly reminder that invoice ${invoice.number} is due ${dueFormatted}.`;

  const result: SendEmailResult = await sendEmail({
    to: invoice.customer.email,
    subject: `Reminder: invoice ${invoice.number} from ${invoice.business.name}`,
    text: `Hi ${invoice.customer.name},\n\n${situationLine} The balance remaining is ${dueCentsFormatted}.\n\nIf you've already sent payment, please disregard this note — thank you!\n\n— ${invoice.business.name}`,
    html: `
      <p>Hi ${escapeHtml(invoice.customer.name)},</p>
      <p>${escapeHtml(situationLine)} The balance remaining is <strong>${dueCentsFormatted}</strong>.</p>
      <p>If you've already sent payment, please disregard this note — thank you!</p>
      <p>— ${escapeHtml(invoice.business.name)}</p>
    `.trim(),
  });

  if (!result.sent) {
    return result.reason === "not_configured"
      ? { delivered: false, reason: "not_configured" }
      : { delivered: false, reason: "send_failed", message: result.message };
  }

  await prisma.$transaction([
    prisma.invoice.update({ where: { id: invoiceId }, data: { lastReminderSentAt: new Date() } }),
    prisma.auditLog.create({
      data: {
        businessId,
        action: "invoice.reminder_sent",
        entityType: "Invoice",
        entityId: invoiceId,
        metadata: JSON.stringify({ invoiceNumber: invoice.number, dueCents }),
      },
    }),
  ]);

  return { delivered: true };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
