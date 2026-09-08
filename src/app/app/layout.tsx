import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/server/tenant";
import { getMyBusinesses } from "@/server/services/businesses";
import SignOutButton from "@/components/SignOutButton";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  let ctx;
  try {
    ctx = await requireUser();
  } catch {
    redirect("/login");
  }

  const businesses = await getMyBusinesses(ctx.userId);
  if (businesses.length === 0) {
    // Should not happen via normal signup flow, but fail safe rather than
    // showing a broken dashboard with no business context.
    redirect("/signup");
  }
  const business = businesses[0]!; // v1: single business per user; switcher is P1

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-400">{business.name}</p>
            <nav className="mt-1 flex gap-5 text-sm font-medium">
              <Link href="/app" className="text-ink hover:text-accent">
                Overview
              </Link>
              <Link href="/app/invoices" className="text-ink hover:text-accent">
                Invoices
              </Link>
              <Link href="/app/customers" className="text-ink hover:text-accent">
                Customers
              </Link>
              <Link href="/app/expenses" className="text-ink hover:text-accent">
                Expenses
              </Link>
              <Link href="/app/forecast" className="text-ink hover:text-accent">
                Forecast
              </Link>
            </nav>
          </div>
          <SignOutButton />
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-8">{children}</main>
    </div>
  );
}
