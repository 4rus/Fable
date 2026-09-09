import Link from "next/link";
import { LogoMark } from "@/components/icons";

/**
 * Shared two-pane authentication layout: an editorial statement on the
 * left (the same voice as the marketing site), the form on the right.
 * Collapses to a single column on small screens — the statement moves
 * above the form instead of disappearing, so auth still feels like part
 * of the same product on mobile, not a bare form.
 */
export default function AuthShell({
  statement,
  support,
  children,
}: {
  statement: string;
  support: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid min-h-screen md:grid-cols-2">
      <div className="flex flex-col justify-between border-line px-6 py-8 md:border-r md:px-14 md:py-12">
        <Link href="/" className="flex items-center gap-2">
          <LogoMark className="text-ink" />
          <span className="text-[15px] font-semibold tracking-tight text-ink">Fable</span>
        </Link>

        <div className="my-10 max-w-md md:my-0">
          <p className="font-serif text-[26px] leading-snug tracking-tight text-ink sm:text-[32px]">
            {statement}
          </p>
          <p className="mt-4 text-[15px] leading-relaxed text-muted">{support}</p>
        </div>

        <p className="hidden text-xs text-muted md:block">
          © {new Date().getFullYear()} Fable
        </p>
      </div>

      <div className="flex items-center justify-center px-6 py-10 md:px-14 md:py-12">
        <div className="w-full max-w-sm">{children}</div>
      </div>
    </div>
  );
}
