import "server-only";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { logError, logInfo } from "@/lib/logger";
import { syncBankConnection, disconnectBankConnection } from "./connections";

/**
 * DISPATCH LOGIC for an ALREADY-VERIFIED Plaid webhook body — see
 * webhookVerification.ts for the signature check, which must always run
 * first (the route handler is the only place that calls both, in that
 * order). Kept separate so this business logic is testable on its own
 * against real BankConnection rows without needing a real, independently
 * signed webhook for every test case — the signature check has its own
 * dedicated tests.
 *
 * Every webhook_type/webhook_code this app doesn't act on is logged, not
 * silently dropped — a documented gap, matching the project's convention
 * elsewhere, rather than a decision made by omission.
 */

const webhookBodySchema = z.object({
  webhook_type: z.string(),
  webhook_code: z.string(),
  item_id: z.string().optional(),
  error: z.object({ error_code: z.string().optional() }).nullish(),
});

export async function handlePlaidWebhook(rawBody: unknown): Promise<void> {
  const parsed = webhookBodySchema.safeParse(rawBody);
  if (!parsed.success) {
    logError("plaid webhook: body did not match the expected shape", parsed.error);
    return;
  }
  const { webhook_type, webhook_code, item_id, error } = parsed.data;

  if (!item_id) {
    logInfo("plaid webhook: no item_id, nothing to act on", { webhook_type, webhook_code });
    return;
  }

  const connection = await prisma.bankConnection.findUnique({ where: { providerItemId: item_id } });
  if (!connection) {
    // Not an error -- e.g. a webhook for an Item that was already
    // disconnected and its row could plausibly be pruned by a future
    // retention job, or one for an Item created by a different
    // environment sharing the same Plaid client_id.
    logInfo("plaid webhook: no BankConnection for this item_id", { item_id, webhook_type, webhook_code });
    return;
  }

  if (webhook_type === "TRANSACTIONS" && webhook_code === "SYNC_UPDATES_AVAILABLE") {
    if (connection.status !== "ACTIVE") {
      logInfo("plaid webhook: skipping sync for a non-ACTIVE connection", {
        connectionId: connection.id,
        status: connection.status,
      });
      return;
    }
    await syncBankConnection(connection.businessId, connection.id);
    return;
  }

  if (webhook_type === "ITEM") {
    if (webhook_code === "ERROR") {
      await prisma.bankConnection.update({
        where: { id: connection.id },
        data: { status: "ERROR", errorCode: error?.error_code ?? null },
      });
      return;
    }

    // The user revoked access at their bank/Plaid's end, not through
    // Fable -- reflect that the same way our own "Disconnect" button
    // does (best-effort provider-side revoke, which is likely already a
    // no-op here since the provider initiated this, then mark REVOKED
    // locally so historical data survives, same as any other disconnect).
    if (
      webhook_code === "USER_PERMISSION_REVOKED" ||
      webhook_code === "USER_ACCOUNT_REVOKED" ||
      webhook_code === "PENDING_DISCONNECT"
    ) {
      await disconnectBankConnection(connection.businessId, connection.id);
      return;
    }

    // LOGIN_REPAIRED, PENDING_EXPIRATION, WEBHOOK_UPDATE_ACKNOWLEDGED, and
    // others: no reconnect-via-Link-update-mode flow exists in the UI yet
    // to act on these meaningfully (a documented gap, not an oversight —
    // see README). Logged so they're visible, not silently swallowed.
  }

  logInfo("plaid webhook: no handler for this webhook_type/webhook_code", { webhook_type, webhook_code });
}
