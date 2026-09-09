"use client";

import { useState } from "react";
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
  SettingsIcon,
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
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <>
      {/* Mobile topbar — sidebar collapses into this below the md breakpoint */}
      <div className="flex items-center justify-between border-b border-line bg-surface px-4 py-3 md:hidden">
        <div className="flex items-center gap-2">
          <LogoMark className="text-ink" />
          <span className="text-[14px] font-semibold tracking-tight text-ink">Financial OS</span>
        </div>
        <button
          onClick={() => setMobileOpen(true)}
          aria-label="Open menu"
          className="rounded-md p-1.5 text-ink hover:bg-canvas"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6}>
            <path d="M4 7h16M4 12h16M4 17h16" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {mobileOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-black/20" onClick={() => setMobileOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-64">
            <SidebarContent
              businessName={businessName}
              userEmail={userEmail}
              onNavigate={() => setMobileOpen(false)}
            />
          </div>
        </div>
      )}

      <aside className="hidden w-60 shrink-0 md:block">
        <div className="sticky top-0 h-screen">
          <SidebarContent businessName={businessName} userEmail={userEmail} />
        </div>
      </aside>
    </>
  );
}

function SidebarContent({
  businessName,
  userEmail,
  onNavigate,
}: {
  businessName: string;
  userEmail: string;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const initial = userEmail.charAt(0).toUpperCase();

  return (
    <div className="flex h-full flex-col border-r border-line bg-surface">
      <div className="flex items-center gap-2 px-4 pb-4 pt-5">
        <LogoMark className="text-ink" />
        <span className="text-[14px] font-semibold tracking-tight text-ink">Financial OS</span>
      </div>

      <div className="relative px-3 pb-4">
        <button
          onClick={() => setWorkspaceOpen((v) => !v)}
          className="flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-canvas"
        >
          <span className="min-w-0">
            <span className="block truncate text-[13px] font-medium text-ink">{businessName}</span>
            <span className="block text-[11px] text-muted">Workspace</span>
          </span>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="shrink-0 text-muted">
            <path d="M7 10l5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        {workspaceOpen && (
          <div className="absolute left-3 right-3 top-full z-10 mt-1 rounded-lg border border-line bg-surface px-3 py-2.5 text-[12px] text-muted shadow-card">
            Multiple workspaces aren&apos;t supported yet — this is the only one on your account.
          </div>
        )}
      </div>

      <nav className="flex-1 space-y-0.5 px-3">
        {NAV.map((item) => {
          const active = item.exact ? pathname === item.href : pathname?.startsWith(item.href);
          const ItemIcon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              className={
                "relative flex items-center gap-2.5 px-2.5 py-[7px] text-[13.5px] transition-colors " +
                (active ? "font-medium text-ink" : "text-muted hover:text-ink")
              }
            >
              {active && <span className="absolute -left-3 h-4 w-[2px] bg-ink" />}
              <ItemIcon className={active ? "text-ink" : "text-muted"} />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="px-3 pb-1">
        <Link
          href="/app/settings/team"
          onClick={onNavigate}
          className={
            "flex items-center gap-2.5 px-2.5 py-[7px] text-[13.5px] transition-colors " +
            (pathname?.startsWith("/app/settings") ? "font-medium text-ink" : "text-muted hover:text-ink")
          }
        >
          <SettingsIcon className={pathname?.startsWith("/app/settings") ? "text-ink" : "text-muted"} />
          Settings
        </Link>
      </div>

      <div className="relative border-t border-line px-3 py-3">
        <button
          onClick={() => setProfileOpen((v) => !v)}
          className="flex w-full items-center gap-2.5 rounded-lg px-1.5 py-1.5 text-left hover:bg-canvas"
        >
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-ink text-[11px] font-medium text-white">
            {initial}
          </span>
          <span className="min-w-0 flex-1 truncate text-[12.5px] text-muted">{userEmail}</span>
        </button>
        {profileOpen && (
          <div className="absolute bottom-full left-3 right-3 mb-1 rounded-lg border border-line bg-surface py-1 shadow-card">
            <button
              onClick={() => signOut({ callbackUrl: "/login" })}
              className="block w-full px-3 py-2 text-left text-[13px] text-ink hover:bg-canvas"
            >
              Sign out
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
