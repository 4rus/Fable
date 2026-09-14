import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { logError, logInfo } from "@/lib/logger";

/**
 * The one place any LLM call goes through — same "single seam, graceful
 * degradation" pattern as src/lib/email.ts (Resend) and
 * src/server/services/storage/ (Supabase Storage). Two states, both real
 * (never a fake result):
 *
 *  - ANTHROPIC_API_KEY configured: actually calls the Anthropic API,
 *    returns { ok: true, text }.
 *  - Not configured (the default until you add a key — see README): does
 *    NOT call anything, returns { ok: false, reason: "not_configured" } so
 *    callers fall back to the plain deterministic text they already had.
 *
 * IMPORTANT — this module has no financial knowledge of its own. It is a
 * dumb text-generation seam; see src/server/services/narration.ts for the
 * grounding rules (never invent a number, always fall back on doubt) that
 * make it safe to use next to real financial data.
 */

export type GenerateTextResult =
  | { ok: true; text: string }
  | { ok: false; reason: "not_configured" }
  | { ok: false; reason: "generation_failed"; message: string };

// Cheap, fast model — this task is constrained rewriting of already-correct
// text, not open-ended reasoning, so a small model is the right fit both
// for cost and for latency on a page load. Override via ANTHROPIC_MODEL if
// a different one becomes preferable later.
const DEFAULT_MODEL = "claude-haiku-4-5-20251001";

// Cache the client, but keyed by the actual API key value — not just "have
// we ever checked" — so a later change to ANTHROPIC_API_KEY (e.g. adding
// it after the process started, or a test stubbing it) is picked up
// instead of permanently reusing whatever the first call happened to see.
let cachedClient: Anthropic | null = null;
let cachedForKey: string | undefined;

function getClient(): Anthropic | null {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (apiKey === cachedForKey) return cachedClient;
  cachedForKey = apiKey;
  cachedClient = apiKey ? new Anthropic({ apiKey }) : null;
  return cachedClient;
}

export interface GenerateTextParams {
  system: string;
  prompt: string;
  maxTokens?: number;
}

export interface GenerateFromImageParams {
  system: string;
  prompt: string;
  imageBase64: string;
  mediaType: "image/jpeg" | "image/png";
  maxTokens?: number;
}

/**
 * Same seam and same two honest states as generateText — the only
 * difference is a vision message (receipt scanning, feature request
 * 2026-09; see src/server/services/receiptScan.ts). Still a dumb
 * text-generation call with no financial authority of its own: the
 * caller is responsible for validating whatever comes back (bounds,
 * shape) before trusting it, exactly like generateText's callers do.
 */
export async function generateFromImage(params: GenerateFromImageParams): Promise<GenerateTextResult> {
  const anthropic = getClient();
  if (!anthropic) {
    logInfo("receipt scan not run: ANTHROPIC_API_KEY not configured");
    return { ok: false, reason: "not_configured" };
  }

  try {
    const response = await anthropic.messages.create({
      model: process.env.ANTHROPIC_MODEL || DEFAULT_MODEL,
      max_tokens: params.maxTokens ?? 512,
      temperature: 0,
      system: params.system,
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: params.mediaType, data: params.imageBase64 } },
            { type: "text", text: params.prompt },
          ],
        },
      ],
    });

    const block = response.content.find(
      (b): b is Anthropic.TextBlock => b.type === "text",
    );
    if (!block || !block.text.trim()) {
      return { ok: false, reason: "generation_failed", message: "empty response" };
    }
    return { ok: true, text: block.text };
  } catch (err) {
    logError("receipt scan generation threw", err);
    return {
      ok: false,
      reason: "generation_failed",
      message: err instanceof Error ? err.message : "unknown error",
    };
  }
}

export async function generateText(params: GenerateTextParams): Promise<GenerateTextResult> {
  const anthropic = getClient();
  if (!anthropic) {
    logInfo("narration not generated: ANTHROPIC_API_KEY not configured");
    return { ok: false, reason: "not_configured" };
  }

  try {
    const response = await anthropic.messages.create({
      model: process.env.ANTHROPIC_MODEL || DEFAULT_MODEL,
      max_tokens: params.maxTokens ?? 1024,
      temperature: 0, // constrained rewriting, not creative generation
      system: params.system,
      messages: [{ role: "user", content: params.prompt }],
    });

    const block = response.content.find(
      (b): b is Anthropic.TextBlock => b.type === "text",
    );
    if (!block || !block.text.trim()) {
      return { ok: false, reason: "generation_failed", message: "empty response" };
    }
    return { ok: true, text: block.text };
  } catch (err) {
    logError("narration generation threw", err);
    return {
      ok: false,
      reason: "generation_failed",
      message: err instanceof Error ? err.message : "unknown error",
    };
  }
}
