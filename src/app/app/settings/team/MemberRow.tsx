"use client";

import { useState, useTransition } from "react";
import { revokeMemberAction } from "@/server/actions/team";

export default function MemberRow({
  businessId,
  membershipId,
  name,
  email,
  role,
  isSelf,
  canManage,
}: {
  businessId: string;
  membershipId: string;
  name: string;
  email: string;
  role: string;
  isSelf: boolean;
  canManage: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex items-center justify-between px-5 py-3.5">
      <div>
        <p className="text-sm font-medium text-ink">
          {name} {isSelf && <span className="text-muted">(you)</span>}
        </p>
        <p className="text-xs text-muted">{email}</p>
        {error && <p className="mt-1 text-xs text-bad">{error}</p>}
      </div>
      <div className="flex items-center gap-3">
        <span className="text-xs font-medium text-muted">{role === "OWNER" ? "Owner" : "Member"}</span>
        {canManage && !isSelf && (
          <button
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                setError(null);
                const result = await revokeMemberAction(businessId, membershipId);
                if (result?.error) setError(result.error);
              })
            }
            className="text-xs font-medium text-muted hover:text-bad disabled:opacity-50"
          >
            {pending ? "Removing…" : "Remove"}
          </button>
        )}
      </div>
    </div>
  );
}
