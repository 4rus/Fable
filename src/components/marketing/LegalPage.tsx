import Link from "next/link";
import { LogoMark } from "@/components/icons";

/**
 * Shared shell for legal placeholder pages. Fable is pre-launch — these
 * are explicitly labeled as placeholders rather than dressed up to look
 * like a real, reviewed policy. See the pages under src/app/legal/.
 */
export default function LegalPage({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen">
      <header className="border-b border-line px-5 py-5 md:px-10">
        <Link href="/" className="flex items-center gap-2">
          <LogoMark className="text-ink" />
          <span className="text-[15px] font-semibold tracking-tight text-ink">Fable</span>
        </Link>
      </header>
      <main className="mx-auto max-w-2xl px-5 py-16 md:px-10">
        <h1 className="font-serif text-3xl tracking-tight text-ink">{title}</h1>
        <div className="prose-fable mt-8 space-y-4 text-[15px] leading-relaxed text-muted">
          {children}
        </div>
        <p className="mt-12">
          <Link href="/" className="text-sm font-medium text-accent hover:underline">
            ← Back to Fable
          </Link>
        </p>
      </main>
    </div>
  );
}
