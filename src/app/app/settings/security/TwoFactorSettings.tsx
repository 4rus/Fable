"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  setupTwoFactorAction,
  confirmTwoFactorAction,
  disableTwoFactorAction,
  type ConfirmTwoFactorState,
  type DisableTwoFactorState,
} from "@/server/actions/twoFactor";

const initialConfirmState: ConfirmTwoFactorState = {};
const initialDisableState: DisableTwoFactorState = {};

type Stage = "off" | "starting" | "enrolling" | "backupCodes" | "on" | "disabling";

export default function TwoFactorSettings({
  initialEnabled,
  initialRemainingBackupCodes,
}: {
  initialEnabled: boolean;
  initialRemainingBackupCodes: number;
}) {
  const [stage, setStage] = useState<Stage>(initialEnabled ? "on" : "off");
  const [setupError, setSetupError] = useState<string | null>(null);
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);
  const [remainingBackupCodes, setRemainingBackupCodes] = useState(initialRemainingBackupCodes);

  const [confirmState, confirmFormAction] = useActionState(
    async (prev: ConfirmTwoFactorState, formData: FormData) => {
      const result = await confirmTwoFactorAction(prev, formData);
      if (result.backupCodes) {
        setBackupCodes(result.backupCodes);
        setRemainingBackupCodes(result.backupCodes.length);
        setStage("backupCodes");
      }
      return result;
    },
    initialConfirmState,
  );

  const [disableState, disableFormAction] = useActionState(
    async (prev: DisableTwoFactorState, formData: FormData) => {
      const result = await disableTwoFactorAction(prev, formData);
      if (!result.error) setStage("off");
      return result;
    },
    initialDisableState,
  );

  async function startSetup() {
    setSetupError(null);
    setStage("starting");
    const result = await setupTwoFactorAction();
    if ("error" in result) {
      setSetupError(result.error);
      setStage("off");
      return;
    }
    setQrCodeDataUrl(result.qrCodeDataUrl);
    setSecret(result.secret);
    setStage("enrolling");
  }

  if (stage === "off" || stage === "starting") {
    return (
      <div className="field-surface p-6">
        <p className="text-sm font-medium text-ink">Two-factor authentication is off</p>
        <p className="mt-1.5 text-sm leading-relaxed text-muted">
          Add a second step at sign-in using an authenticator app (Google Authenticator, 1Password,
          Authy, or similar) — so a leaked password alone isn&apos;t enough to get into your account.
        </p>
        {setupError && <p className="mt-3 text-sm text-bad">{setupError}</p>}
        <button
          type="button"
          onClick={startSetup}
          disabled={stage === "starting"}
          className="btn-primary mt-4"
        >
          {stage === "starting" ? "Starting…" : "Enable two-factor authentication"}
        </button>
      </div>
    );
  }

  if (stage === "enrolling") {
    return (
      <div className="field-surface p-6">
        <p className="text-sm font-medium text-ink">Scan this code</p>
        <p className="mt-1.5 text-sm leading-relaxed text-muted">
          Open your authenticator app and scan the QR code below, or enter the setup key manually.
        </p>

        {qrCodeDataUrl && (
          // eslint-disable-next-line @next/next/no-img-element -- a locally-generated data: URL, not a remote image next/image would optimize
          <img
            src={qrCodeDataUrl}
            alt="Scan this QR code with your authenticator app to set up two-factor authentication"
            className="mt-4 h-[150px] w-[150px] rounded-lg border border-line"
          />
        )}

        {secret && (
          <p className="mt-3 text-xs text-muted">
            Can&apos;t scan?{" "}
            <span className="rounded bg-canvas px-1.5 py-0.5 font-mono tracking-wide text-ink">{secret}</span>
          </p>
        )}

        <form action={confirmFormAction} className="mt-5 space-y-3">
          <div>
            <label htmlFor="code" className="field-label">6-digit code</label>
            <input
              id="code"
              name="code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="123456"
              required
              className="field max-w-[180px]"
            />
          </div>
          {confirmState.error && <p className="text-sm text-bad">{confirmState.error}</p>}
          <ConfirmButton />
        </form>
      </div>
    );
  }

  if (stage === "backupCodes" && backupCodes) {
    return (
      <div className="field-surface p-6">
        <p className="text-sm font-medium text-ink">Save your backup codes</p>
        <p className="mt-1.5 text-sm leading-relaxed text-muted">
          Each code works once, if you ever lose access to your authenticator app. Store them
          somewhere safe — this is the only time they&apos;ll be shown.
        </p>
        <div className="mt-4 grid grid-cols-2 gap-2 rounded-lg bg-canvas p-4 font-mono text-sm text-ink">
          {backupCodes.map((code) => (
            <span key={code}>{code}</span>
          ))}
        </div>
        <button type="button" onClick={() => setStage("on")} className="btn-primary mt-5">
          I&apos;ve saved these codes
        </button>
      </div>
    );
  }

  // stage === "on" | "disabling"
  return (
    <div className="field-surface p-6">
      <p className="text-sm font-medium text-ink">Two-factor authentication is on</p>
      <p className="mt-1.5 text-sm leading-relaxed text-muted">
        {remainingBackupCodes} unused backup code{remainingBackupCodes === 1 ? "" : "s"} remaining.
      </p>

      {stage === "on" ? (
        <button type="button" onClick={() => setStage("disabling")} className="btn-secondary mt-4">
          Disable two-factor authentication
        </button>
      ) : (
        <form action={disableFormAction} className="mt-4 space-y-3">
          <div>
            <label htmlFor="disable-password" className="field-label">Confirm your password</label>
            <input
              id="disable-password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              className="field max-w-xs"
            />
          </div>
          {disableState.error && <p className="text-sm text-bad">{disableState.error}</p>}
          <div className="flex gap-2">
            <DisableButton />
            <button type="button" onClick={() => setStage("on")} className="btn-ghost">
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

function ConfirmButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="btn-primary">
      {pending ? "Confirming…" : "Confirm and turn on"}
    </button>
  );
}

function DisableButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="btn-primary">
      {pending ? "Disabling…" : "Disable"}
    </button>
  );
}
