import { requireMembership } from "@/server/tenant";
import { getActiveBusinessContext, listMembers } from "@/server/services/businesses";
import AddMemberForm from "./AddMemberForm";
import MemberRow from "./MemberRow";

export default async function TeamPage() {
  const { userId, business: maybeBusiness } = await getActiveBusinessContext();
  const business = maybeBusiness!;
  const { role } = await requireMembership(business.id);

  const members = await listMembers(business.id);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-serif text-[26px] tracking-tight text-ink">Team</h1>
        <p className="mt-1 text-sm text-muted">Who has access to {business.name}</p>
      </div>

      {role === "OWNER" && <AddMemberForm businessId={business.id} />}

      <div className="divide-y divide-line rounded-xl border border-line">
        {members.map((m) => (
          <MemberRow
            key={m.id}
            businessId={business.id}
            membershipId={m.id}
            name={m.user.name}
            email={m.user.email}
            role={m.role}
            isSelf={m.userId === userId}
            canManage={role === "OWNER"}
          />
        ))}
      </div>

      {role !== "OWNER" && (
        <p className="text-xs text-muted">
          Only an owner can add or remove people from this workspace.
        </p>
      )}
    </div>
  );
}
