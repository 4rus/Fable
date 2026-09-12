import "server-only";
import crypto from "crypto";
import { prisma } from "@/lib/db";
import { formatCentsCompact, formatCentsDelta } from "@/lib/money";
import { logError, logWarn } from "@/lib/logger";
import { generateText, type GenerateTextResult } from "@/lib/ai/anthropic";
import type { Insight } from "@/server/services/insights";
import type { ForecastBreakdown } from "@/server/services/forecast";

/**
 * AI NARRATION LAYER (Phase J).
 *
 * Hard rule, restated from README/insights.ts: the deterministic engines
 * in insights.ts and forecast.ts are the ONLY source of truth. This file
 * takes their already-correct output and asks an LLM to reword it into
 * warmer prose — nothing here is allowed to introduce a new number, date,
 * percentage, or conclusion that wasn't already present in what we fed it.
 *
 * Safety model (defense in depth, not just a polite system prompt):
 *   1. The system prompt tells Claude explicitly: never add, remove, or
 *      change any number; never add a new claim; return strict JSON.
 *   2. `assertNoForeignNumbers` independently re-checks the response after
 *      the fact — every digit sequence in the LLM's output must already
 *      appear somewhere in the facts we gave it. If even one doesn't, the
 *      whole response is thrown away.
 *   3. If the key isn't configured, the call fails, the response isn't
 *      valid JSON, a field is missing, or the number check fails — the
 *      caller gets back the ORIGINAL deterministic text untouched. There
 *      is no code path where a validation failure surfaces broken or
 *      partial narration to a user.
 *
 * Caching: one row per (business, subject) in the `Narration` table,
 * keyed additionally by a hash of the exact facts narrated. A cache hit
 * requires both the subject and the facts hash to match AND the row to be
 * less than 24h old — so normal page loads never re-call the API, but a
 * changed fact (new invoice, new expense) or a new day both force a fresh
 * generation. Only successful, validated LLM output is ever cached —
 * fallback text is cheap to recompute and caching it would risk showing
 * stale plain text for a day after a key is added.
 */

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export interface NarrateOptions {
  /** Injectable for tests — defaults to the real Anthropic call. */
  generate?: (params: { system: string; prompt: string; maxTokens?: number }) => Promise<GenerateTextResult>;
}

function hashFacts(facts: Record<string, string>): string {
  const canonical = JSON.stringify(facts, Object.keys(facts).sort());
  return crypto.createHash("sha256").update(canonical).digest("hex");
}

/** All digit-sequences (with optional decimal) appearing in a blob of
 * text, normalized by stripping thousands-separator commas and a
 * trailing ".00" so "$3,040" and "$3,040.00" compare equal. This is a
 * heuristic, not a parser — it deliberately errs toward rejecting
 * anything ambiguous rather than risking a fabricated number through. */
function extractNormalizedNumbers(text: string): Set<string> {
  const matches = text.match(/\d[\d,]*(\.\d+)?/g) ?? [];
  return new Set(
    matches.map((m) => {
      const noCommas = m.replace(/,/g, "");
      return noCommas.endsWith(".00") ? noCommas.slice(0, -3) : noCommas;
    }),
  );
}

/** Returns true iff every number in `outputText` already appeared in
 * `inputText`. A single-digit number (0-9) is exempt — those show up
 * constantly as incidental prose ("a couple of things", "day 1") rather
 * than financial facts, and rejecting on them causes far more false
 * positives than the fabrication risk they carry. */
export function assertNoForeignNumbers(inputText: string, outputText: string): boolean {
  const allowed = extractNormalizedNumbers(inputText);
  const produced = extractNormalizedNumbers(outputText);
  for (const n of produced) {
    if (allowed.has(n)) continue;
    if (/^\d$/.test(n)) continue; // single digit, exempt — see comment above
    return false;
  }
  return true;
}

interface NarrateFieldsParams {
  businessId: string;
  subjectKey: string;
  facts: Record<string, string>;
  systemPrompt: string;
  userPrompt: string;
  /** Which keys of `facts` the LLM is expected to rewrite and return. */
  fieldKeys: string[];
}

export interface NarrateFieldsResult {
  fields: Record<string, string>;
  narrated: boolean; // true = real, validated LLM output; false = fallback to `facts` verbatim
}

/** The one core routine every narration entry point below goes through:
 * cache lookup -> LLM call -> JSON parse -> number-safety check -> cache
 * write -> or fallback at any failure point. */
async function narrateFields(params: NarrateFieldsParams, options?: NarrateOptions): Promise<NarrateFieldsResult> {
  const { businessId, subjectKey, facts, fieldKeys } = params;
  const fallback: NarrateFieldsResult = { fields: facts, narrated: false };
  const factsHash = hashFacts(facts);

  try {
    const cached = await prisma.narration.findUnique({
      where: { businessId_subjectKey: { businessId, subjectKey } },
    });
    if (
      cached &&
      cached.factsHash === factsHash &&
      Date.now() - cached.generatedAt.getTime() < CACHE_TTL_MS
    ) {
      const cachedFields = cached.fields as Record<string, string>;
      if (fieldKeys.every((k) => typeof cachedFields[k] === "string")) {
        return { fields: cachedFields, narrated: true };
      }
    }
  } catch (err) {
    // Cache read failing is never a reason to block the page — fall
    // through to generating fresh (or fallback if that also fails).
    logError("narration cache read failed", err, { businessId, subjectKey });
  }

  const generate = options?.generate ?? generateText;
  const result = await generate({ system: params.systemPrompt, prompt: params.userPrompt, maxTokens: 1024 });
  if (!result.ok) return fallback;

  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJson(result.text));
  } catch {
    logWarn("narration response was not valid JSON", { businessId, subjectKey });
    return fallback;
  }

  if (typeof parsed !== "object" || parsed === null) return fallback;
  const record = parsed as Record<string, unknown>;
  const rewritten: Record<string, string> = {};
  for (const key of fieldKeys) {
    const value = record[key];
    if (typeof value !== "string" || value.trim().length === 0) {
      logWarn("narration response missing/invalid field", { businessId, subjectKey, key });
      return fallback;
    }
    rewritten[key] = value.trim();
  }

  const inputBlob = Object.values(facts).join(" ");
  const outputBlob = Object.values(rewritten).join(" ");
  if (!assertNoForeignNumbers(inputBlob, outputBlob)) {
    logWarn("narration rejected: introduced a number not present in the source facts", {
      businessId,
      subjectKey,
    });
    return fallback;
  }

  try {
    await prisma.narration.upsert({
      where: { businessId_subjectKey: { businessId, subjectKey } },
      create: {
        businessId,
        subjectKey,
        factsHash,
        fields: rewritten,
        model: process.env.ANTHROPIC_MODEL || "claude-haiku-4-5-20251001",
      },
      update: {
        factsHash,
        fields: rewritten,
        model: process.env.ANTHROPIC_MODEL || "claude-haiku-4-5-20251001",
        generatedAt: new Date(),
      },
    });
  } catch (err) {
    // Caching is an optimization, not a correctness requirement — a write
    // failure still returns the (valid) narration we just generated.
    logError("narration cache write failed", err, { businessId, subjectKey });
  }

  return { fields: rewritten, narrated: true };
}

/** Claude sometimes wraps JSON in a code fence despite instructions not
 * to — strip that defensively rather than failing parse on it. */
function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  return (fenced?.[1] ?? text).trim();
}

const INSIGHT_SYSTEM_PROMPT = `You rewrite already-correct, fact-checked small-business financial analysis into warmer, plainer prose for a non-accountant small-business owner reading their dashboard.

Rules, all mandatory:
1. Never introduce, change, round, or remove any number, dollar amount, percentage, date, or count. Every single number in your output must already appear, unchanged, somewhere in the input.
2. Never add a new claim, conclusion, or recommendation that isn't already in the input — you are only rephrasing tone and clarity, not adding analysis.
3. Keep each field roughly the same length as the input. Keep the same three fields: "headline", "explanation", "why".
4. Write in a warm, direct, second-person voice ("you", "your") — like a knowledgeable friend, not a corporate report.
5. Return ONLY a JSON object with exactly the keys "headline", "explanation", "why" — no markdown, no code fence, no commentary before or after.`;

/** Rewrites one Insight's headline/explanation/why into friendlier prose.
 * Every other field (id, kind, severity, basis, action, quickAction,
 * evidence) is passed through completely untouched — the LLM never even
 * sees them, since they are either UI wiring or already-terse facts that
 * don't benefit from rewriting. Falls back to the original insight,
 * unchanged, on any failure. */
export async function narrateInsight(
  businessId: string,
  insight: Insight,
  options?: NarrateOptions,
): Promise<Insight> {
  const facts: Record<string, string> = {
    headline: insight.headline,
    explanation: insight.explanation,
    why: insight.why,
  };

  const userPrompt = `Rewrite the following into the JSON shape described in your instructions.\n\n${JSON.stringify(
    facts,
    null,
    2,
  )}`;

  const { fields } = await narrateFields(
    {
      businessId,
      subjectKey: `insight:${insight.id}`,
      facts,
      systemPrompt: INSIGHT_SYSTEM_PROMPT,
      userPrompt,
      fieldKeys: ["headline", "explanation", "why"],
    },
    options,
  );

  return { ...insight, headline: fields.headline!, explanation: fields.explanation!, why: fields.why! };
}

/** Narrates a whole list of insights concurrently. Each insight narrates
 * (or falls back) completely independently — one failure never affects
 * the others. */
export async function narrateInsights(
  businessId: string,
  insights: Insight[],
  options?: NarrateOptions,
): Promise<Insight[]> {
  return Promise.all(insights.map((insight) => narrateInsight(businessId, insight, options)));
}

const FORECAST_SYSTEM_PROMPT = `You write one short, warm paragraph (2-4 sentences) summarizing an already-computed cash forecast for a small-business owner. You are not a forecaster — the numbers you are given are already final and correct; your only job is to explain them in plain English.

Rules, all mandatory:
1. Never introduce, change, round, or remove any number, dollar amount, percentage, or date. Every number in your output must already appear, unchanged, in the input.
2. Never invent a cause, reason, or recommendation that isn't already in the input's driver list or assumptions.
3. Mention the projected amount, that it's a range (state both edges), and name at most the top 1-2 drivers by their given label if there are any — don't list every driver.
4. Write in a warm, direct, second-person voice ("you", "your").
5. Return ONLY a JSON object with exactly one key, "summary", holding the paragraph as a plain string — no markdown, no code fence, no commentary before or after.`;

export interface NarratedForecast {
  summary: string;
  narrated: boolean;
}

/** Narrates a single computeForecast() result into one summary paragraph.
 * Falls back to a plain deterministic sentence (no LLM involved at all)
 * built directly from the same numbers if the LLM path doesn't produce a
 * validated result. */
export async function narrateForecast(
  businessId: string,
  forecast: ForecastBreakdown,
  horizonDays: number,
  options?: NarrateOptions,
): Promise<NarratedForecast> {
  const driverLines = forecast.topDrivers
    .map((d) => `${formatCentsDelta(d.direction === "in" ? d.amountCents : -d.amountCents)} ${d.label}`)
    .join("; ");

  const facts: Record<string, string> = {
    horizonDays: String(horizonDays),
    projected: formatCentsCompact(forecast.projectedCashCents),
    rangeLow: formatCentsCompact(forecast.range.lowCents),
    rangeHigh: formatCentsCompact(forecast.range.highCents),
    confidence: forecast.confidence,
    drivers: driverLines || "none on file",
    assumptions: forecast.assumptions.join(" "),
  };

  const fallbackSummary = buildFallbackForecastSummary(forecast, horizonDays);

  const userPrompt = `Here is the computed forecast to summarize:\n\n${JSON.stringify(facts, null, 2)}\n\nReturn the JSON described in your instructions.`;

  const { fields, narrated } = await narrateFields(
    {
      businessId,
      subjectKey: `forecast:${horizonDays}`,
      facts: { ...facts, fallbackSummary },
      systemPrompt: FORECAST_SYSTEM_PROMPT,
      userPrompt,
      fieldKeys: ["summary"],
    },
    options,
  );

  // narrateFields falls back to returning `facts` verbatim (which has no
  // readable "summary" field) on failure — substitute our real
  // deterministic sentence in that case instead of a raw facts dump.
  if (!narrated) return { summary: fallbackSummary, narrated: false };
  return { summary: fields.summary!, narrated: true };
}

function buildFallbackForecastSummary(forecast: ForecastBreakdown, horizonDays: number): string {
  const top = forecast.topDrivers[0];
  const driverNote = top
    ? ` The biggest factor is ${top.label} (${formatCentsDelta(top.direction === "in" ? top.amountCents : -top.amountCents)}).`
    : "";
  return `Over the next ${horizonDays} days, you're projected to have ${formatCentsCompact(
    forecast.projectedCashCents,
  )}, somewhere between ${formatCentsCompact(forecast.range.lowCents)} and ${formatCentsCompact(
    forecast.range.highCents,
  )} depending on timing.${driverNote}`;
}
