import LegalPage from "@/components/marketing/LegalPage";

export const metadata = { title: "Terms · Fable" };

export default function TermsPage() {
  return (
    <LegalPage title="Terms">
      <p className="rounded-lg bg-warn-soft px-4 py-3 text-warn">
        Placeholder. Fable is in early access and this page has not yet been through legal
        review. It is not a binding terms of service.
      </p>
      <p>
        Fable is pre-launch software. Features, pricing, and availability may change, and no
        uptime or service-level commitments are made at this stage.
      </p>
      <p>
        Before Fable is generally available, this page will be replaced with real terms of
        service prepared with legal counsel.
      </p>
    </LegalPage>
  );
}
