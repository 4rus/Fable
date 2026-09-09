import { redirect } from "next/navigation";
import { requireUser } from "@/server/tenant";
import { getMyBusinesses } from "@/server/services/businesses";
import Sidebar from "@/components/Sidebar";

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
    <div className="flex min-h-screen">
      <Sidebar businessName={business.name} userEmail={ctx.userEmail} />
      <main className="flex-1 px-8 py-10 md:px-12">
        <div className="mx-auto max-w-4xl">{children}</div>
      </main>
    </div>
  );
}
