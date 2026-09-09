import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import PublicNav from "@/components/marketing/PublicNav";
import PublicFooter from "@/components/marketing/PublicFooter";
import ProductPreview from "@/components/marketing/ProductPreview";

export default async function Home() {
  const session = await getServerSession(authOptions);
  if (session?.user) redirect("/app");

  return (
    <div className="min-h-screen">
      <PublicNav />

      {/* HERO */}
      <section className="mx-auto max-w-6xl px-5 pb-20 pt-14 md:px-10 md:pb-28 md:pt-20">
        <div className="max-w-2xl">
          <h1 className="font-serif text-[38px] leading-[1.08] tracking-tight text-ink sm:text-[48px] md:text-[58px]">
            Understand your business before it surprises you.
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted">
            Your invoices, expenses, and transactions already say what&apos;s happening in your
            business. Fable reads them and tells you — in plain language, before you have to ask.
          </p>
          <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:items-center">
            <Link href="/signup" className="btn-primary px-5 py-2.5 text-[15px]">
              Get started
            </Link>
            <Link href="/login" className="btn-secondary px-5 py-2.5 text-[15px]">
              Sign in
            </Link>
          </div>
        </div>

        <div className="mt-16 md:mt-20">
          <ProductPreview />
        </div>
      </section>

      {/* PROBLEM */}
      <section className="border-t border-line bg-surface">
        <div className="mx-auto max-w-6xl px-5 py-20 md:px-10 md:py-28">
          <div className="grid gap-10 md:grid-cols-2 md:gap-16">
            <p className="text-xs font-medium uppercase tracking-wide text-muted">The problem</p>
            <div className="max-w-xl">
              <p className="font-serif text-2xl leading-snug tracking-tight text-ink sm:text-[28px]">
                Small business owners have plenty of financial data. The problem is understanding
                what it means.
              </p>
              <p className="mt-6 text-[15px] leading-relaxed text-muted">
                Invoices. Expenses. Transactions. Cash. Taxes. Upcoming bills. The information
                exists — spread across a bank app, a spreadsheet, an inbox full of receipts. What&apos;s
                missing isn&apos;t data. It&apos;s the two minutes to sit down, connect the dots, and
                answer the question that actually matters: is the business okay?
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* PROMISE */}
      <section id="product" className="mx-auto max-w-6xl px-5 py-20 md:px-10 md:py-28">
        <p className="text-xs font-medium uppercase tracking-wide text-muted">Fable&apos;s promise</p>
        <p className="mt-4 max-w-2xl font-serif text-2xl leading-snug tracking-tight text-ink sm:text-[28px]">
          Fable watches the financial picture and turns it into understanding — not just numbers.
        </p>

        <div className="mt-14 grid gap-px overflow-hidden rounded-2xl border border-line bg-line md:grid-cols-3">
          <PromisePair
            plain="$7,347 cash."
            fable="You have $7,347 available, but $3,040 is tied up in overdue invoices."
          />
          <PromisePair
            plain="Expenses increased 18%."
            fable="Supply spending increased 18% this month, mainly from three purchases."
          />
          <PromisePair
            plain="Projected balance: $2,100."
            fable="At your current pace, cash may become tight before your next major payment."
          />
        </div>
      </section>

      {/* HOW FABLE THINKS */}
      <section id="how-it-works" className="border-t border-line bg-surface">
        <div className="mx-auto max-w-6xl px-5 py-20 md:px-10 md:py-28">
          <p className="text-xs font-medium uppercase tracking-wide text-muted">How Fable thinks</p>
          <p className="mt-4 max-w-2xl font-serif text-2xl leading-snug tracking-tight text-ink sm:text-[28px]">
            Every insight is arithmetic over your own records, not a guess.
          </p>

          <ol className="mt-14 grid gap-8 sm:grid-cols-5">
            {[
              { n: "01", label: "Your financial activity", desc: "Invoices, payments, expenses, transactions." },
              { n: "02", label: "Fable understands it", desc: "Categorized, dated, and tied to real records." },
              { n: "03", label: "Fable finds what matters", desc: "Deterministic rules surface real change." },
              { n: "04", label: "Fable explains it", desc: "Plain language, always traceable to evidence." },
              { n: "05", label: "Fable helps you act", desc: "A next step, not just a fact." },
            ].map((step, i) => (
              <li key={step.n} className="relative">
                <p className="font-serif text-lg text-muted">{step.n}</p>
                <p className="mt-2 text-[15px] font-medium text-ink">{step.label}</p>
                <p className="mt-1.5 text-sm leading-relaxed text-muted">{step.desc}</p>
                {i < 4 && (
                  <span
                    aria-hidden
                    className="absolute right-[-1rem] top-2 hidden text-muted/40 sm:block"
                  >
                    →
                  </span>
                )}
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* TRUST */}
      <section id="security" className="mx-auto max-w-6xl px-5 py-20 md:px-10 md:py-28">
        <div className="grid gap-10 md:grid-cols-2 md:gap-16">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted">Trust</p>
            <p className="mt-4 max-w-md font-serif text-2xl leading-snug tracking-tight text-ink sm:text-[28px]">
              Financial software has to earn trust with engineering, not marketing language.
            </p>
            <p className="mt-6 max-w-md text-[15px] leading-relaxed text-muted">
              We won&apos;t claim certifications Fable doesn&apos;t have. Here&apos;s what&apos;s actually true
              today.
            </p>
          </div>

          <ul className="space-y-6">
            <TrustItem
              title="Money is never a floating-point guess"
              body="Every dollar amount is stored and calculated in integer cents. Totals are always recomputed on the server — a client-sent total is never trusted."
            />
            <TrustItem
              title="Your business's data stays yours"
              body="Every record is scoped to your business and checked against your real membership on every request — never inferred from an ID a browser happens to send."
            />
            <TrustItem
              title="Passwords are never stored in plain text"
              body="Passwords are hashed with bcrypt before they ever touch the database. We can't see your password, and neither can anyone who gains access to it."
            />
            <TrustItem
              title="Uploaded files are verified, not trusted"
              body="Receipt and attachment uploads are validated by their actual content, size-capped, and served only through an authorization check — never a public URL."
            />
          </ul>
        </div>
      </section>

      {/* PRICING */}
      <section id="pricing" className="border-t border-line bg-surface">
        <div className="mx-auto max-w-6xl px-5 py-20 text-center md:px-10 md:py-28">
          <p className="text-xs font-medium uppercase tracking-wide text-muted">Pricing</p>
          <p className="mx-auto mt-4 max-w-xl font-serif text-2xl leading-snug tracking-tight text-ink sm:text-[28px]">
            Fable is in early access. Pricing isn&apos;t final yet.
          </p>
          <p className="mx-auto mt-4 max-w-md text-[15px] leading-relaxed text-muted">
            We&apos;d rather tell you that plainly than invent numbers. Create an account to try
            Fable now — we&apos;ll be upfront well before anything is billed.
          </p>
          <Link href="/signup" className="btn-primary mt-8 inline-flex px-5 py-2.5 text-[15px]">
            Get started
          </Link>
        </div>
      </section>

      {/* FINAL CTA */}
      <section className="mx-auto max-w-6xl px-5 py-24 md:px-10 md:py-32">
        <p className="max-w-2xl font-serif text-3xl leading-[1.15] tracking-tight text-ink sm:text-[40px]">
          Stop managing numbers. Start understanding your business.
        </p>
        <div className="mt-8">
          <Link href="/signup" className="btn-primary px-5 py-2.5 text-[15px]">
            Get started
          </Link>
        </div>
      </section>

      <PublicFooter />
    </div>
  );
}

function PromisePair({ plain, fable }: { plain: string; fable: string }) {
  return (
    <div className="bg-canvas p-7 sm:p-8">
      <p className="text-sm text-muted line-through decoration-muted/50">{plain}</p>
      <p className="mt-3 text-[15px] leading-relaxed text-ink">{fable}</p>
    </div>
  );
}

function TrustItem({ title, body }: { title: string; body: string }) {
  return (
    <li className="border-b border-line pb-6 last:border-none last:pb-0">
      <p className="text-[15px] font-medium text-ink">{title}</p>
      <p className="mt-1.5 text-sm leading-relaxed text-muted">{body}</p>
    </li>
  );
}
