/**
 * Enum-shaped string values stored in the database. SQLite (local dev) has
 * no native enum type and we want the dev/prod schema to stay identical
 * when DATABASE_URL points at Postgres, so these columns are plain Strings
 * in prisma/schema.prisma. These are the single source of truth for the
 * allowed values — always go through them (and the Zod schemas that use
 * them) rather than writing a raw string.
 */

export const ROLES = ["OWNER", "MEMBER"] as const;
export type MembershipRole = (typeof ROLES)[number];

export const MEMBERSHIP_STATUSES = ["ACTIVE", "REVOKED"] as const;
export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number];

export const INVOICE_STATUSES = ["DRAFT", "SENT", "PARTIALLY_PAID", "PAID", "VOID"] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const CATEGORY_TYPES = ["INCOME", "EXPENSE"] as const;
export type CategoryType = (typeof CATEGORY_TYPES)[number];

export const PAYMENT_METHODS = ["cash", "check", "card", "bank_transfer", "other"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
