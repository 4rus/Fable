import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma } from "@/lib/db";
import { createTestBusiness } from "./helpers";
import {
  narrateInsight,
  narrateForecast,
  assertNoForeignNumbers,
} from "@/server/services/narration";
import type { Insight } from "@/server/services/insights";
import type { ForecastBreakdown } from "@/server/services/forecast";
import type { GenerateTextResult } from "@/lib/ai/anthropic";

// Captured at module load, before the top-level beforeEach below stubs it
// out — lets the "real Anthropic API" describe block below opt back into
// the developer's actual key, same skip-if-unconfigured pattern as
// tests/bank-connections.test.ts (PLAID_CONFIGURED).
const REAL_ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const ANTHROPIC_CONFIGURED = !!REAL_ANTHROPIC_API_KEY;
const describeIfConfigured = ANTHROPIC_CONFIGURED ? describe : describe.skip;

// Same reasoning as reminder-email.test.ts / invoice-email.test.ts: force
// the honest not-configured path for tests that specifically exercise it,
// regardless of what's in the developer's real .env.
beforeEach(() => vi.stubEnv("ANTHROPIC_API_KEY", ""));
afterEach(() => vi.unstubAllEnvs());

function makeInsight(overrides: Partial<Insight> = {}): Insight {
  return {
    id: "test-insight",
    kind: "FACT",
    severity: "attention",
    headline: "$3,040 is waiting on overdue invoices",
    explanation: "2 customers are overdue. Acme's $1,200 invoice is now 14 days late.",
    why: "Collecting these would add meaningful cushion to your projected cash position.",
    basis: "Based on 2 open invoices",
    evidence: [],
    ...overrides,
  };
}

function makeForecast(overrides: Partial<ForecastBreakdown> = {}): ForecastBreakdown {
  return {
    asOfDate: new Date().toISOString(),
    horizonDays: 90,
    targetDate: new Date().toISOString(),
    currentCashCents: 500_000,
    expectedReceivablesCents: 120_000,
    expectedExpensesCents: 80_000,
    projectedCashCents: 540_000,
    range: { lowCents: 400_000, highCents: 620_000 },
    confidence: "medium",
    assumptions: ["Acme has no payment history — assumed a neutral 70% chance of collecting."],
    topDrivers: [{ direction: "in", label: "Acme Co — INV-1", amountCents: 120_000 }],
    ...overrides,
  };
}

function jsonResult(obj: unknown): GenerateTextResult {
  return { ok: true, text: JSON.stringify(obj) };
}

describe("assertNoForeignNumbers", () => {
  it("accepts output whose numbers all appear in the input", () => {
    const input = "You have $3,040 overdue across 2 invoices.";
    const output = "Right now $3,040 is sitting overdue on 2 invoices.";
    expect(assertNoForeignNumbers(input, output)).toBe(true);
  });

  it("rejects a fabricated number not present anywhere in the input", () => {
    const input = "You have $3,040 overdue across 2 invoices.";
    const output = "You have $3,040 overdue, up 15% from last month.";
    expect(assertNoForeignNumbers(input, output)).toBe(false);
  });

  it("tolerates comma formatting and a trailing .00 difference", () => {
    const input = "Total: $3040.00 across 2 invoices.";
    const output = "You're owed $3,040 across 2 invoices.";
    expect(assertNoForeignNumbers(input, output)).toBe(true);
  });

  it("exempts incidental single digits", () => {
    const input = "One thing needs attention.";
    const output = "There's 1 thing worth a look today.";
    expect(assertNoForeignNumbers(input, output)).toBe(true);
  });
});

describe("narrateInsight", () => {
  it("falls back to the original text when ANTHROPIC_API_KEY is not configured", async () => {
    const business = await createTestBusiness();
    const insight = makeInsight({ id: `no-key-${business.id}` });

    const result = await narrateInsight(business.id, insight);

    expect(result.headline).toBe(insight.headline);
    expect(result.explanation).toBe(insight.explanation);
    expect(result.why).toBe(insight.why);

    const cached = await prisma.narration.findUnique({
      where: { businessId_subjectKey: { businessId: business.id, subjectKey: `insight:${insight.id}` } },
    });
    expect(cached).toBeNull(); // fallback is never cached
  });

  it("uses validated LLM output and caches it when the numbers all check out", async () => {
    const business = await createTestBusiness();
    const insight = makeInsight({ id: `valid-${business.id}` });
    const generate = vi.fn(async (): Promise<GenerateTextResult> =>
      jsonResult({
        headline: "$3,040 is sitting on overdue invoices",
        explanation: "2 customers haven't paid yet — Acme's $1,200 bill is 14 days past due.",
        why: "Getting this in would give your cash position real breathing room.",
      }),
    );

    const result = await narrateInsight(business.id, insight, { generate });

    expect(generate).toHaveBeenCalledTimes(1);
    expect(result.headline).toBe("$3,040 is sitting on overdue invoices");
    // Untouched fields pass through completely unchanged.
    expect(result.id).toBe(insight.id);
    expect(result.basis).toBe(insight.basis);
    expect(result.severity).toBe(insight.severity);

    const cached = await prisma.narration.findUnique({
      where: { businessId_subjectKey: { businessId: business.id, subjectKey: `insight:${insight.id}` } },
    });
    expect(cached).not.toBeNull();
    expect((cached!.fields as Record<string, string>).headline).toBe("$3,040 is sitting on overdue invoices");
  });

  it("rejects and falls back when the LLM invents a number not in the source facts", async () => {
    const business = await createTestBusiness();
    const insight = makeInsight({ id: `fabricated-${business.id}` });
    const generate = vi.fn(async (): Promise<GenerateTextResult> =>
      jsonResult({
        headline: "$3,040 is overdue, up 22% from last quarter",
        explanation: insight.explanation,
        why: insight.why,
      }),
    );

    const result = await narrateInsight(business.id, insight, { generate });

    expect(result.headline).toBe(insight.headline); // fell back, "22%" never shown
    const cached = await prisma.narration.findUnique({
      where: { businessId_subjectKey: { businessId: business.id, subjectKey: `insight:${insight.id}` } },
    });
    expect(cached).toBeNull();
  });

  it("rejects and falls back on malformed JSON", async () => {
    const business = await createTestBusiness();
    const insight = makeInsight({ id: `malformed-${business.id}` });
    const generate = vi.fn(async (): Promise<GenerateTextResult> => ({ ok: true, text: "not json at all" }));

    const result = await narrateInsight(business.id, insight, { generate });
    expect(result.headline).toBe(insight.headline);
  });

  it("serves a validated cache hit without calling the LLM again", async () => {
    const business = await createTestBusiness();
    const insight = makeInsight({ id: `cache-hit-${business.id}` });
    const generate = vi.fn(async (): Promise<GenerateTextResult> =>
      jsonResult({ headline: "Rewritten headline", explanation: insight.explanation, why: insight.why }),
    );

    const first = await narrateInsight(business.id, insight, { generate });
    expect(first.headline).toBe("Rewritten headline");
    expect(generate).toHaveBeenCalledTimes(1);

    const secondGenerate = vi.fn(async (): Promise<GenerateTextResult> => {
      throw new Error("should not be called on a cache hit");
    });
    const second = await narrateInsight(business.id, insight, { generate: secondGenerate });
    expect(second.headline).toBe("Rewritten headline");
    expect(secondGenerate).not.toHaveBeenCalled();
  });

  it("regenerates once the underlying facts change, even with the same insight id", async () => {
    const business = await createTestBusiness();
    const id = `facts-change-${business.id}`;
    const first = makeInsight({ id, headline: "$1,000 is overdue" });
    const generate1 = vi.fn(async (): Promise<GenerateTextResult> =>
      jsonResult({ headline: "You've got $1,000 overdue", explanation: first.explanation, why: first.why }),
    );
    await narrateInsight(business.id, first, { generate: generate1 });

    const second = makeInsight({ id, headline: "$2,000 is overdue" });
    const generate2 = vi.fn(async (): Promise<GenerateTextResult> =>
      jsonResult({ headline: "You've got $2,000 overdue", explanation: second.explanation, why: second.why }),
    );
    const result = await narrateInsight(business.id, second, { generate: generate2 });

    expect(generate2).toHaveBeenCalledTimes(1);
    expect(result.headline).toBe("You've got $2,000 overdue");
  });
});

describe("narrateForecast", () => {
  it("falls back to a real deterministic sentence built from the same numbers when no key is configured", async () => {
    const business = await createTestBusiness();
    const forecast = makeForecast();

    const result = await narrateForecast(business.id, forecast, 90);

    expect(result.narrated).toBe(false);
    expect(result.summary).toContain("90 days");
    expect(result.summary).toContain("Acme Co — INV-1");
  });

  it("uses validated LLM output for the forecast summary", async () => {
    const business = await createTestBusiness();
    const forecast = makeForecast({ horizonDays: 60 });
    const generate = vi.fn(async (): Promise<GenerateTextResult> =>
      jsonResult({
        summary:
          "Over the next 90 days you're on track for about $5,400, likely between $4,000 and $6,200, mostly thanks to Acme Co — INV-1 coming in.",
      }),
    );

    const result = await narrateForecast(business.id, forecast, 90, { generate });

    expect(result.narrated).toBe(true);
    expect(result.summary).toContain("Acme Co — INV-1");

    const cached = await prisma.narration.findUnique({
      where: { businessId_subjectKey: { businessId: business.id, subjectKey: "forecast:90" } },
    });
    expect(cached).not.toBeNull();
  });

  it("falls back when the LLM's forecast summary invents a number", async () => {
    const business = await createTestBusiness();
    const forecast = makeForecast();
    const generate = vi.fn(async (): Promise<GenerateTextResult> =>
      jsonResult({ summary: "You're projected to have $5,400, an 18% improvement from last month." }),
    );

    const result = await narrateForecast(business.id, forecast, 90, { generate });
    expect(result.narrated).toBe(false);
    expect(result.summary).toContain("90 days");
  });
});

// Real, live calls to the Anthropic API — no mocking of the HTTP layer at
// all, unlike every test above (which injects a fake `generate` to test
// the caching/validation logic deterministically). Skipped with an
// honest message, not a false pass, when ANTHROPIC_API_KEY isn't set —
// same convention as tests/bank-connections.test.ts's real Plaid Sandbox
// tests.
describeIfConfigured("real Anthropic API", () => {
  beforeEach(() => vi.stubEnv("ANTHROPIC_API_KEY", REAL_ANTHROPIC_API_KEY!));

  it(
    "narrates a real insight with the real model, and the result passes the number-safety check",
    async () => {
      const business = await createTestBusiness();
      const insight = makeInsight({ id: `live-${business.id}` });

      const result = await narrateInsight(business.id, insight);

      // A real rewrite came back — the LLM is free to leave any individual
      // field as-is if it judges it already reads well (that's a valid
      // response, not a failure), but the three fields together should
      // not be byte-identical to the input in every single case.
      const inputBlob = `${insight.headline}|${insight.explanation}|${insight.why}`;
      const outputBlob = `${result.headline}|${result.explanation}|${result.why}`;
      expect(outputBlob).not.toBe(inputBlob);
      // And it's exactly the numbers from the source facts, nothing else —
      // assertNoForeignNumbers already ran inside narrateInsight to decide
      // whether to cache this; re-assert it here directly against the
      // live response for a belt-and-suspenders check in this specific
      // test.
      expect(
        assertNoForeignNumbers(
          `${insight.headline} ${insight.explanation} ${insight.why}`,
          `${result.headline} ${result.explanation} ${result.why}`,
        ),
      ).toBe(true);

      const cached = await prisma.narration.findUnique({
        where: { businessId_subjectKey: { businessId: business.id, subjectKey: `insight:${insight.id}` } },
      });
      expect(cached).not.toBeNull();
      expect(cached!.model).toContain("claude");
    },
    20_000,
  );

  it(
    "narrates a real forecast summary with the real model, grounded in the same numbers",
    async () => {
      const business = await createTestBusiness();
      const forecast = makeForecast();

      const result = await narrateForecast(business.id, forecast, 90);

      expect(result.narrated).toBe(true);
      // The real dollar figures must appear verbatim somewhere in the prose.
      expect(result.summary).toMatch(/5,400|5400/);
    },
    20_000,
  );
});
