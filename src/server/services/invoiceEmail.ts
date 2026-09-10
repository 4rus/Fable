import "server-only";
import { prisma } from "@/lib/db";
import { ForbiddenError } from "@/server/tenant";
import { formatCents } from "@/lib/money";
import { sendEmail, type SendEmailResult } from "@/lib/email";
import { renderInvoicePdf } from "@/lib/pdf/invoice";
import { markInvoiceSent } from "@/server/services/invoices";

export class MissingCustomerEmailError extends Error {
  constructor() {
    super("This customer doesn't have an email address on file yet.");
    this.name = "MissingCustomerEmailError";
  }
}

export class InvoiceNotSendableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvoiceNotSendableError";
  }
}

export type SendInvoiceEmailResult =
  | { delivered: true }
  | { delivered: false; reason: "not_configured" }
  | { delivered: false; reason: "send_failed"; message: string };

/**
 * The real "send invoice to your customer" path: renders a PDF, emails it
 * via src/lib/email.ts, and — only on a DRAFT invoice, only on actual
 * delivery success — advances status to SENT the same way the old
 * "mark as sent" button did. Resending an already-SENT invoice (e.g. a
 * reminder) still emails the PDF again but doesn't re-run the DRAFT-only
 * status transition, and doesn't error either — that's a legitimate
 * action, not a state-machine violation.
 */
export async function sendInvoiceEmail(businessId: string, invoiceId: string): Promise<SendInvoiceEmailResult> {
  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId, businessId, deletedAt: null },
    include: { customer: true, lineItems: true, business: true },
  });
  if (!invoice) throw new ForbiddenError("Invoice not found for this business");
  if (invoice.status === "VOID") {
    throw new InvoiceNotSendableError("This invoice has been voided and can't be sent.");
  }
  if (invoice.status === "DRAFT" && invoice.lineItems.length === 0) {
    throw new InvoiceNotSendableError("Add at least one line item before sending this invoice.");
  }
  if (!invoice.customer.email) {
    throw new MissingCustomerEmailError();
  }

  const pdfBuffer = await renderInvoicePdf({
    businessName: invoice.business.name,
    currency: invoice.business.currency,
    invoiceNumber: invoice.number,
    issueDate: invoice.issueDate,
    dueDate: invoice.dueDate,
    customerName: invoice.customer.name,
    customerEmail: invoice.customer.email,
    lineItems: invoice.lineItems.map((li) => ({
      description: li.description,
      quantity: li.quantity,
      unitPriceCents: li.unitPriceCents,
      amountCents: li.amountCents,
    })),
    subtotalCents: invoice.subtotalCents,
    taxCents: invoice.taxCents,
    totalCents: invoice.totalCents,
    notes: invoice.notes,
  });

  const totalFormatted = formatCents(invoice.totalCents, invoice.business.currency);
  const dueFormatted = invoice.dueDate.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const result: SendEmailResult = await sendEmail({
    to: invoice.customer.email,
    subject: `Invoice ${invoice.number} from ${invoice.business.name}`,
    text: `Hi ${invoice.customer.name},\n\n${invoice.business.name} has sent you invoice ${invoice.number} for ${totalFormatted}, due ${dueFormatted}.\n\nThe invoice is attached as a PDF.\n\n— ${invoice.business.name}`,
    html: `
      <p>Hi ${escapeHtml(invoice.customer.name)},</p>
      <p>${escapeHtml(invoice.business.name)} has sent you invoice <strong>${escapeHtml(invoice.number)}</strong> for <strong>${totalFormatted}</strong>, due ${dueFormatted}.</p>
      <p>The invoice is attached as a PDF.</p>
      <p>— ${escapeHtml(invoice.business.name)}</p>
    `.trim(),
    attachments: [{ filename: `${invoice.number}.pdf`, content: pdfBuffer }],
  });

  if (!result.sent) {
    return result.reason === "not_configured"
      ? { delivered: false, reason: "not_configured" }
      : { delivered: false, reason: "send_failed", message: result.message };
  }

  if (invoice.status === "DRAFT") {
    await markInvoiceSent(businessId, invoiceId);
  }

  await prisma.auditLog.create({
    data: {
      businessId,
      action: "invoice.email_sent",
      entityType: "Invoice",
      entityId: invoiceId,
      metadata: JSON.stringify({ invoiceNumber: invoice.number }),
    },
  });

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
