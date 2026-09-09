import Link from "next/link";
import { LogoMark } from "@/components/icons";

export default function PublicFooter() {
  return (
    <footer className="border-t border-line">
      <div className="mx-auto max-w-6xl px-5 py-14 md:px-10">
        <div className="grid gap-12 md:grid-cols-[1.3fr_1fr_1fr]">
          <div className="max-w-sm">
            <div className="flex items-center gap-2">
              <LogoMark className="text-ink" />
              <span className="text-[15px] font-semibold tracking-tight text-ink">Fable</span>
            </div>
            <p className="mt-4 text-sm leading-relaxed text-muted">
              A financial operating system for small business owners. Fable reads your real
              transactions and explains what they mean — never the other way around.
            </p>
          </div>

          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted">Product</p>
            <ul className="mt-4 space-y-3 text-sm">
              <li><a href="#product" className="text-ink hover:text-accent">Product</a></li>
              <li><a href="#security" className="text-ink hover:text-accent">Security</a></li>
              <li><a href="#pricing" className="text-ink hover:text-accent">Pricing</a></li>
            </ul>
          </div>

          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted">Account</p>
            <ul className="mt-4 space-y-3 text-sm">
              <li><Link href="/login" className="text-ink hover:text-accent">Sign in</Link></li>
              <li><Link href="/signup" className="text-ink hover:text-accent">Get started</Link></li>
            </ul>
          </div>
        </div>

        <div className="mt-14 flex flex-col gap-3 border-t border-line pt-6 text-xs text-muted sm:flex-row sm:items-center sm:justify-between">
          <p>© {new Date().getFullYear()} Fable. All rights reserved.</p>
          <div className="flex gap-5">
            <Link href="/legal/privacy" className="hover:text-ink">Privacy</Link>
            <Link href="/legal/terms" className="hover:text-ink">Terms</Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
