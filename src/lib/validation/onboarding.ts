import { z } from "zod";

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
    .refine((v) => /^-?\d+(\.\d{1,2})?$/.test(v), "Enter a valid dollar amount"),
  asOfDate: z.string().trim().min(1, "Enter a date"),
});
