import { NextRequest, NextResponse } from "next/server";
import { verifyPlaidWebhook, WebhookVerificationError } from "@/server/services/bank/webhookVerification";
import { handlePlaidWebhook } from "@/server/services/bank/webhookHandler";
import { logError } from "@/lib/logger";

/**
 * Real-time bank sync (Phase F). Plaid POSTs here whenever an Item it's
 * watching has new transaction data (or a status change) — this is what
 * lets a connected account stay current without the user having to
 * remember to click "Sync now". Registered per-Item at Link creation
 * time (see plaidClient.ts's createLinkToken) only when PLAID_WEBHOOK_URL
 * is configured; without it, this route exists but Plaid never calls it,
 * and manual "Sync now" keeps working exactly as it always has.
 *
 * SECURITY: every request is verified before its body is trusted for
 * anything — see webhookVerification.ts. An unverified POST to this
 * route (anyone can find the URL; it's not secret) must never be able to
 * trigger a sync or a status change for someone else's connection. The
 * verified body's own item_id is still only ever used to look up a
 * BankConnection row, never as a businessId — same "treat as
 * unauthenticated input" discipline as everywhere else in this app (see
 * src/server/tenant.ts).
 *
 * NOT YET DONE: this runs synchronously in the request/response cycle
 * (no background job queue exists yet — see README "Deployment", Phase
 * C). Fine for this app's current volume; a slow sync under real
 * traffic should move to a queued job rather than blocking Plaid's
 * webhook delivery.
 */
export async function POST(req: NextRequest) {
  const rawBody = await req.text();

  try {
    await verifyPlaidWebhook(rawBody, req.headers.get("plaid-verification"));
  } catch (err) {
    if (err instanceof WebhookVerificationError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    logError("plaid webhook verification threw unexpectedly", err);
    return NextResponse.json({ error: "Verification failed" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  try {
    await handlePlaidWebhook(body);
  } catch (err) {
    // Logged, not surfaced as a non-2xx: a transient failure on our end
    // (e.g. a slow sync) shouldn't put this Item into Plaid's retry
    // backoff for a webhook we did, in fact, receive and attempt to
    // handle. The connection's own status (see webhookHandler.ts) and the
    // manual "Sync now" fallback both still catch up regardless.
    logError("plaid webhook handling failed", err);
  }

  return NextResponse.json({ ok: true });
}
