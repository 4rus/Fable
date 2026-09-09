import LegalPage from "@/components/marketing/LegalPage";

export const metadata = { title: "Privacy · Fable" };

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy">
      <p className="rounded-lg bg-warn-soft px-4 py-3 text-warn">
        Placeholder. Fable is in early access and this page has not yet been through legal
        review. It is not a binding privacy policy.
      </p>
      <p>
        Fable stores the financial records you enter — invoices, customers, expenses, and
        transactions — scoped to your business and never shared across accounts. See the
        engineering notes on tenant isolation and data handling in the project README.
      </p>
      <p>
        Before Fable is generally available, this page will be replaced with a real privacy
        policy prepared with legal counsel, covering what data is collected, how it&apos;s used,
        how long it&apos;s retained, and how to request deletion or export.
      </p>
    </LegalPage>
  );
}
