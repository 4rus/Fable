/**
 * THE ONLY MODULE THAT SHOULD DO MONEY MATH.
 *
 * Rule: all authoritative monetary values are integer minor units (cents),
 * stored as plain JS numbers (safe: Number.MAX_SAFE_INTEGER is ~9x10^15,
 * far beyond any realistic small-business cent amount). Never use floating
 * point arithmetic (`0.1 + 0.2`) on money. Never store dollars-as-float.
 *
 * Every function here is pure and deterministic — no I/O, no randomness —
 * so it can be unit-tested exhaustively (see tests/money.test.ts).
 */

/** Round-half-up to the nearest cent. Only used at input boundaries where a
 * dollar string is converted to cents; never on already-integer cents. */
export function dollarsToCents(dollars: number | string): number {
  const n = typeof dollars === "string" ? Number(dollars) : dollars;
  if (!Number.isFinite(n)) {
    throw new MoneyError(`Invalid dollar amount: ${dollars}`);
  }
  // Guard against float noise (e.g. 19.99 * 100 = 1998.9999999999998)
  return Math.round(n * 100);
}

export function centsToDollars(cents: number): number {
  assertInteger(cents);
  return cents / 100;
}

/** Formats cents as a localized currency string. Display-only — never parse
 * this back into a number for calculation. */
export function formatCents(cents: number, currency = "USD"): string {
  assertInteger(cents);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
  }).format(cents / 100);
}

export function addCents(...values: number[]): number {
  return values.reduce((sum, v) => {
    assertInteger(v);
    return sum + v;
  }, 0);
}

export function subtractCents(a: number, b: number): number {
  assertInteger(a);
  assertInteger(b);
  return a - b;
}

/** Multiplies a per-unit cent amount by an integer quantity. Quantities are
 * always whole numbers in this product (no fractional units in v1). */
export function multiplyCentsByQuantity(unitCents: number, quantity: number): number {
  assertInteger(unitCents);
  if (!Number.isInteger(quantity) || quantity < 0) {
    throw new MoneyError(`Quantity must be a non-negative integer, got ${quantity}`);
  }
  return unitCents * quantity;
}

export function isNegative(cents: number): boolean {
  assertInteger(cents);
  return cents < 0;
}

export function assertInteger(cents: number): void {
  if (!Number.isInteger(cents)) {
    throw new MoneyError(`Expected integer cents, got ${cents}`);
  }
}

/** Clamp used only for display of partial-payment progress bars etc. Never
 * use this to silently "fix" a financial total — an out-of-range total is a
 * bug to surface, not hide. */
export function clampNonNegative(cents: number): number {
  assertInteger(cents);
  return Math.max(0, cents);
}

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MoneyError";
  }
}
