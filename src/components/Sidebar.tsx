"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import {
  LogoMark,
  OverviewIcon,
  InvoiceIcon,
  CustomersIcon,
  ExpensesIcon,
  ForecastIcon,
} from "@/components/icons";

const NAV = [
  { href: "/app", label: "Overview", icon: OverviewIcon, exact: true },
  { href: "/app/invoices", label: "Invoices", icon: InvoiceIcon, exact: false },
  { href: "/app/customers", label: "Customers", icon: CustomersIcon, exact: false },
  { href: "/app/expenses", label: "Expenses", icon: ExpensesIcon, exact: false },
  { href: "/app/forecast", label: "Forecast", icon: ForecastIcon, exact: false },
];

export default function Sidebar({
  businessName,
  userEmail,
}: {
  businessName: string;
  userEmail: string;
}) {
  const pathname = usePathname();

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-line bg-surface">
      <div className="flex items-center gap-2 px-5 pb-5 pt-6">
        <LogoMark className="text-ink" />
        <span className="text-[15px] font-semibold tracking-tight text-ink">Financial OS</span>
      </div>

      <div className="mx-4 mb-4 rounded-lg bg-canvas px-3 py-2.5">
        <p className="truncate text-sm font-medium text-ink">{businessName}</p>
        <p className="text-xs text-muted">Workspace</p>
      </div>

      <nav className="flex-1 space-y-0.5 px-3">
        {NAV.map((item) => {
          const active = item.exact ? pathname === item.href : pathname?.startsWith(item.href);
          const ItemIcon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={
                "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors " +
                (active ? "bg-ink text-white" : "text-slate-600 hover:bg-canvas hover:text-ink")
              }
            >
              <ItemIcon />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-line px-4 py-4">
        <p className="truncate text-xs text-muted">{userEmail}</p>
        <button
          onClick={() => signOut({ callbackUrl: "/login" })}
          className="mt-1.5 text-xs font-medium text-muted hover:text-ink"
        >
          Sign out
        </button>
      </div>
    </aside>
  );
}
