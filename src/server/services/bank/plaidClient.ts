import "server-only";
import {
  Configuration,
  PlaidApi,
  PlaidEnvironments,
  Products,
  CountryCode,
  type Transaction as PlaidTransaction,
  type AccountBase,
} from "plaid";

/**
 * THE ONLY FILE IN THIS APP ALLOWED TO IMPORT `plaid` OR REFERENCE
 * PLAID-SPECIFIC TYPES. Everything outside src/server/services/bank/
 * talks to the provider-agnostic shapes in connections.ts — see the
 * schema.prisma comment above BankConnection for why. Swapping or adding
 * a provider (e.g. Flinks) means writing a new file like this one that
 * produces the same shapes `connections.ts` expects, not touching
 * anything downstream.
 */

function getEnv(): keyof typeof PlaidEnvironments {
  const env = process.env.PLAID_ENV ?? "sandbox";
  if (env !== "sandbox" && env !== "development" && env !== "production") {
    throw new Error(`Invalid PLAID_ENV "${env}" — must be "sandbox", "development", or "production".`);
  }
  return env;
}

function getClient(): PlaidApi {
  const clientId = process.env.PLAID_CLIENT_ID;
  const secret = process.env.PLAID_SECRET;
  if (!clientId || !secret) {
    throw new Error("PLAID_CLIENT_ID / PLAID_SECRET are not set. Bank connectivity is not configured.");
  }
  const configuration = new Configuration({
    basePath: PlaidEnvironments[getEnv()],
    baseOptions: {
      headers: {
        "PLAID-CLIENT-ID": clientId,
        "PLAID-SECRET": secret,
      },
    },
  });
  return new PlaidApi(configuration);
}

/** True only when real credentials are configured — callers use this to
 * fail with a clear, honest message rather than a raw SDK error. */
export function isPlaidConfigured(): boolean {
  return !!process.env.PLAID_CLIENT_ID && !!process.env.PLAID_SECRET;
}

/** Starts a Link session. `clientUserId` should be Fable's own userId —
 * never anything that could double as a real-world identifier Plaid
 * shouldn't see. */
export async function createLinkToken(clientUserId: string): Promise<string> {
  const client = getClient();
  const response = await client.linkTokenCreate({
    user: { client_user_id: clientUserId },
    client_name: "Fable",
    products: [Products.Transactions],
    // US + Canada — Fable's stated market. Add country codes deliberately,
    // not speculatively; each one changes which institutions Link shows.
    country_codes: [CountryCode.Us, CountryCode.Ca],
    language: "en",
    // Registers the Item for real-time sync webhooks (Phase F) — only
    // when a public URL is actually configured. Without it, Plaid never
    // learns where to send webhooks and every connection made under
    // this Link session stays exactly as manual-sync-only as it is
    // today; this is an additive, opt-in registration, not a
    // requirement for Link to work.
    webhook: process.env.PLAID_WEBHOOK_URL || undefined,
  });
  return response.data.link_token;
}

export interface ExchangeResult {
  accessToken: string;
  itemId: string;
}

/** Exchanges Link's one-time public_token for a durable access_token.
 * The access_token is the actual credential — callers must encrypt it
 * (src/lib/crypto.ts) before persisting, immediately, never logging or
 * returning it beyond this call. */
export async function exchangePublicToken(publicToken: string): Promise<ExchangeResult> {
  const client = getClient();
  const response = await client.itemPublicTokenExchange({ public_token: publicToken });
  return { accessToken: response.data.access_token, itemId: response.data.item_id };
}

export interface ProviderAccount {
  providerAccountId: string;
  name: string;
  mask: string | null;
  type: string;
  subtype: string | null;
  currentBalanceCents: number | null;
  availableBalanceCents: number | null;
  isoCurrencyCode: string;
}

function toCents(dollars: number | null | undefined): number | null {
  return dollars == null ? null : Math.round(dollars * 100);
}

function mapAccount(a: AccountBase): ProviderAccount {
  return {
    providerAccountId: a.account_id,
    name: a.name,
    mask: a.mask ?? null,
    type: a.type,
    subtype: a.subtype ?? null,
    currentBalanceCents: toCents(a.balances.current),
    availableBalanceCents: toCents(a.balances.available),
    isoCurrencyCode: a.balances.iso_currency_code ?? "USD",
  };
}

export interface ProviderConnectionInfo {
  institutionId: string | null;
  institutionName: string | null;
  accounts: ProviderAccount[];
}

/** Fetches accounts + institution info for a freshly-exchanged connection. */
export async function getConnectionInfo(accessToken: string): Promise<ProviderConnectionInfo> {
  const client = getClient();
  const accountsResponse = await client.accountsGet({ access_token: accessToken });
  const institutionId = accountsResponse.data.item.institution_id ?? null;

  let institutionName: string | null = null;
  if (institutionId) {
    try {
      const instResponse = await client.institutionsGetById({
        institution_id: institutionId,
        country_codes: [CountryCode.Us, CountryCode.Ca],
      });
      institutionName = instResponse.data.institution.name;
    } catch {
      // Non-fatal — the connection still works without a display name;
      // fall back to showing the institutionId in the UI if this fails.
    }
  }

  return {
    institutionId,
    institutionName,
    accounts: accountsResponse.data.accounts.map(mapAccount),
  };
}

export interface ProviderTransaction {
  providerTransactionId: string;
  providerAccountId: string;
  amountCents: number;
  isoCurrencyCode: string;
  postedDate: Date;
  authorizedDate: Date | null;
  merchantName: string | null;
  description: string;
  pending: boolean;
  providerCategory: string | null;
}

function mapTransaction(t: PlaidTransaction): ProviderTransaction {
  return {
    providerTransactionId: t.transaction_id,
    providerAccountId: t.account_id,
    // Plaid's own convention: positive = money out, negative = money in.
    // Kept as-is (not flipped) — documented on the Transaction model.
    amountCents: Math.round(t.amount * 100),
    isoCurrencyCode: t.iso_currency_code ?? "USD",
    postedDate: new Date(t.date),
    authorizedDate: t.authorized_date ? new Date(t.authorized_date) : null,
    merchantName: t.merchant_name ?? null,
    description: t.name,
    pending: t.pending,
    providerCategory: t.personal_finance_category?.primary ?? t.category?.[0] ?? null,
  };
}

export interface SyncPage {
  added: ProviderTransaction[];
  modified: ProviderTransaction[];
  removedProviderTransactionIds: string[];
  nextCursor: string;
  hasMore: boolean;
}

/** One page of Plaid's incremental transaction sync. Callers loop while
 * `hasMore` is true, persisting `nextCursor` after each page so a crash
 * mid-sync resumes rather than reprocessing everything. */
export async function syncTransactionsPage(accessToken: string, cursor: string | null): Promise<SyncPage> {
  const client = getClient();
  const response = await client.transactionsSync({
    access_token: accessToken,
    cursor: cursor ?? undefined,
  });
  return {
    added: response.data.added.map(mapTransaction),
    modified: response.data.modified.map(mapTransaction),
    removedProviderTransactionIds: response.data.removed.map((r) => r.transaction_id!).filter(Boolean),
    nextCursor: response.data.next_cursor,
    hasMore: response.data.has_more,
  };
}

/** Revokes Fable's access to an Item — the provider-side equivalent of
 * "disconnect". Best-effort: if the provider call fails (e.g. already
 * revoked on their end), the caller still marks the connection REVOKED
 * locally rather than blocking the user from disconnecting. */
export async function removeItem(accessToken: string): Promise<void> {
  const client = getClient();
  await client.itemRemove({ access_token: accessToken });
}

export interface WebhookVerificationJwk {
  alg: string;
  crv: string;
  kid: string;
  kty: string;
  use: string;
  x: string;
  y: string;
}

/** Fetches the public key Plaid signed a given webhook with, by the `kid`
 * from that webhook's JWT header — see
 * src/server/services/bank/webhookVerification.ts, the only caller. This
 * is an outbound call WE make to Plaid (unlike the webhook delivery
 * itself, which is inbound and needs a real public URL) — real and
 * testable even without one. */
export async function getWebhookVerificationKey(keyId: string): Promise<WebhookVerificationJwk> {
  const client = getClient();
  const response = await client.webhookVerificationKeyGet({ key_id: keyId });
  return response.data.key;
}
