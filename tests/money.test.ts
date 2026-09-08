import { describe, it, expect } from "vitest";
import {
  dollarsToCents,
  centsToDollars,
  formatCents,
  addCents,
  subtractCents,
  multiplyCentsByQuantity,
  isNegative,
  MoneyError,
} from "@/lib/money";

describe("money", () => {
  it("converts dollars to cents without float drift", () => {
    expect(dollarsToCents(19.99)).toBe(1999);
    expect(dollarsToCents(0.1)).toBe(10);
    expect(dollarsToCents("0.2")).toBe(20);
    // Three-decimal inputs are not a real currency shape (forms only ever
    // send two decimals) — we don't make promises about rounding a third
    // decimal digit, only that two-decimal inputs convert exactly.
    expect(dollarsToCents(9.07)).toBe(907);
  });

  it("round-trips cents to dollars", () => {
    expect(centsToDollars(1999)).toBe(19.99);
    expect(centsToDollars(0)).toBe(0);
  });

  it("rejects non-integer cents everywhere", () => {
    expect(() => centsToDollars(19.5)).toThrow(MoneyError);
    expect(() => addCents(100, 19.5)).toThrow(MoneyError);
    expect(() => subtractCents(19.5, 1)).toThrow(MoneyError);
  });

  it("adds and subtracts cents exactly", () => {
    expect(addCents(100, 200, 300)).toBe(600);
    expect(addCents()).toBe(0);
    expect(subtractCents(500, 200)).toBe(300);
    expect(subtractCents(200, 500)).toBe(-300);
  });

  it("multiplies unit price by an integer quantity", () => {
    expect(multiplyCentsByQuantity(1999, 3)).toBe(5997);
    expect(multiplyCentsByQuantity(1999, 0)).toBe(0);
    expect(() => multiplyCentsByQuantity(1999, 1.5)).toThrow(MoneyError);
    expect(() => multiplyCentsByQuantity(1999, -1)).toThrow(MoneyError);
  });

  it("detects negative amounts (refunds etc.)", () => {
    expect(isNegative(-100)).toBe(true);
    expect(isNegative(0)).toBe(false);
    expect(isNegative(100)).toBe(false);
  });

  it("formats cents as currency for display only", () => {
    expect(formatCents(0)).toBe("$0.00");
    expect(formatCents(150000)).toBe("$1,500.00");
    expect(formatCents(-500)).toBe("-$5.00");
  });
});
