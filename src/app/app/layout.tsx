import { redirect } from "next/navigation";
import { getActiveBusinessContext } from "@/server/services/businesses";
import Sidebar from "@/components/Sidebar";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  let ctx;
  try {
    ctx = await getActiveBusinessContext();
  } catch {
    redirect("/login");
  }
  const { userEmail, businesses, business } = ctx;

  if (!business) {
    // Should not happen via normal signup flow, but fail safe rather than
    // showing a broken dashboard with no business context.
    redirect("/signup");
  }

  return (
    <div className="min-h-screen md:flex">
      <Sidebar businesses={businesses} activeBusinessId={business.id} userEmail={userEmail} />
      <main className="min-w-0 flex-1 px-5 py-8 md:px-12 md:py-10">
        <div className="mx-auto max-w-3xl">{children}</div>
      </main>
    </div>
  );
}
