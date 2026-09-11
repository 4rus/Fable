import { requireMembership } from "@/server/tenant";
import { getActiveBusinessContext } from "@/server/services/businesses";
import { listBankConnections } from "@/server/services/bank/connections";
import { formatCents } from "@/lib/money";
import ConnectBankButton from "./ConnectBankButton";
import ConnectionCard from "./ConnectionCard";

export default async function BankPage() {
  const { business: maybeBusiness } = await getActiveBusinessContext();
  const business = maybeBusiness!;
  await requireMembership(business.id);

  const connections = await listBankConnections(business.id);
  const hasAnyAccounts = connections.some((c) => c.accounts.length > 0);

  return (
    <div className="max-w-2xl space-y-8">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="font-serif text-[26px] tracking-tight text-ink">Bank</h1>
          <p className="mt-1 text-sm text-muted">
            Connect an account so Fable can see your transactions automatically.
          </p>
        </div>
        <ConnectBankButton businessId={business.id} />
      </div>

      {connections.length === 0 ? (
        <div className="field-surface p-8 text-center">
          <p className="font-serif text-lg text-ink">Fable becomes useful when it can see your business.</p>
          <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-muted">
            Connect a bank account and Fable starts reading your real transactions automatically —
            no more manual entry or CSV uploads for the accounts you connect.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {connections.map((c) => (
            <ConnectionCard
              key={c.id}
              businessId={business.id}
              connection={c}
              formatBalance={(cents, currency) => formatCents(cents, currency)}
            />
          ))}
        </div>
      )}

      {!hasAnyAccounts && connections.length > 0 && (
        <p className="text-xs text-muted">
          Connected, but no accounts synced yet — this can take a moment on the first sync.
        </p>
      )}

      <p className="text-xs text-muted">
        Fable never sees or stores your bank password. Access can be revoked at any time by
        disconnecting an account here, or from your bank&apos;s own security settings.
      </p>
    </div>
  );
}
