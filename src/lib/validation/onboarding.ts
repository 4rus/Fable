import { z } from "zod";

// Same $10M sanity ceiling as every other money input in the app (see the
// `cents` bound in validation/invoices.ts) — a real small business's
// starting cash is nowhere near this, so it exists purely to reject
// garbage/overflow input with a clear message instead of it reaching the
// database. Found by adversarial testing (Phase P): before this bound
// existed, a huge value (e.g. "999999999999999999999") passed the format
// check, then failed at the Prisma layer with "Unable to fit value 1e+23
// into a 64-bit signed integer" — a real error, but surfaced to the user
// as a generic "Could not save. Please try again," which is actively
// misleading (retrying the same value will never succeed). Negative
// values ARE allowed (unlike `cents` elsewhere) — a business can
// genuinely start with negative cash (e.g. owing on a line of credit).
const MAX_STARTING_CASH_DOLLARS = 10_000_000;

/** A dollar-string form input, e.g. "1250.50" or "0" — converted to cents
 * server-side (src/lib/money.ts is the only place that math happens).
 * Deliberately permissive on format (a leading "$", commas) since this is
 * a human typing into a text field, not an API payload. */
export const startingCashSchema = z.object({
  amount: z
    .string()
    .trim()
    .min(1, "Enter an amount")
    .transform((v) => v.replace(/[$,]/g, ""))
    .refine((v) => /^-?\d+(\.\d{1,2})?$/.test(v), "Enter a valid dollar amount")
    .refine(
      (v) => Math.abs(Number(v)) <= MAX_STARTING_CASH_DOLLARS,
      `Enter an amount under $${MAX_STARTING_CASH_DOLLARS.toLocaleString()}`,
    ),
  asOfDate: z.string().trim().min(1, "Enter a date"),
});
