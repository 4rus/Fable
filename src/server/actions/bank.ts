"use server";

import { revalidatePath } from "next/cache";
import { requireUser, requireMembership, ForbiddenError } from "@/server/tenant";
import { logError } from "@/lib/logger";
import {
  startBankConnection,
  completeBankConnection,
  disconnectBankConnection,
  syncBankConnection,
  ProviderNotConfiguredError,
} from "@/server/services/bank/connections";

export type LinkTokenState = { linkToken: string } | { error: string };

export async function createLinkTokenAction(): Promise<LinkTokenState> {
  const { userId } = await requireUser();
  try {
    const { linkToken } = await startBankConnection(userId);
    return { linkToken };
  } catch (err) {
    if (err instanceof ProviderNotConfiguredError) return { error: err.message };
    logError("createLinkToken failed", err);
    return { error: "Could not start the bank connection. Please try again." };
  }
}

export type CompleteConnectionState = { ok: true } | { error: string };

export async function completeConnectionAction(
  businessId: string,
  publicToken: string,
): Promise<CompleteConnectionState> {
  const { businessId: verifiedBusinessId } = await requireMembership(businessId);

  try {
    const connection = await completeBankConnection(verifiedBusinessId, publicToken);
    // Initial sync immediately, so the connection is useful the moment
    // it's made rather than leaving the user staring at an empty account
    // list until some later scheduled sync runs. A failure here doesn't
    // undo the connection — it's now real and reconnectable/retryable
    // from the UI — just logged.
    try {
      await syncBankConnection(verifiedBusinessId, connection.id);
    } catch (syncErr) {
      logError("initial sync after bank connect failed", syncErr, { connectionId: connection.id });
    }
  } catch (err) {
    if (err instanceof ProviderNotConfiguredError) return { error: err.message };
    logError("completeBankConnection failed", err);
    return { error: "Could not finish connecting your bank. Please try again." };
  }

  revalidatePath("/app/bank");
  revalidatePath("/app");
  return { ok: true };
}

export type BankActionState = { error?: string };

export async function disconnectConnectionAction(
  businessId: string,
  connectionId: string,
): Promise<BankActionState> {
  const { businessId: verifiedBusinessId } = await requireMembership(businessId);
  try {
    await disconnectBankConnection(verifiedBusinessId, connectionId);
  } catch (err) {
    if (err instanceof ForbiddenError) return { error: err.message };
    logError("disconnectBankConnection failed", err);
    return { error: "Could not disconnect this account. Please try again." };
  }
  revalidatePath("/app/bank");
  return {};
}

export async function syncNowAction(businessId: string, connectionId: string): Promise<BankActionState> {
  const { businessId: verifiedBusinessId } = await requireMembership(businessId);
  try {
    await syncBankConnection(verifiedBusinessId, connectionId);
  } catch (err) {
    if (err instanceof ForbiddenError) return { error: err.message };
    logError("syncBankConnection failed", err);
    return { error: "Could not sync this account right now. Please try again." };
  }
  revalidatePath("/app/bank");
  revalidatePath("/app");
  return {};
}
