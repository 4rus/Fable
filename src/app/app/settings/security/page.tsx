import { requireUser } from "@/server/tenant";
import { getTwoFactorStatus } from "@/server/services/twoFactor";
import TwoFactorSettings from "./TwoFactorSettings";

export default async function SecuritySettingsPage() {
  const { userId } = await requireUser();
  const status = await getTwoFactorStatus(userId);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-serif text-[26px] tracking-tight text-ink">Security</h1>
        <p className="mt-1 text-sm text-muted">Protect your account with a second factor.</p>
      </div>

      <TwoFactorSettings initialEnabled={status.enabled} initialRemainingBackupCodes={status.remainingBackupCodes} />
    </div>
  );
}
