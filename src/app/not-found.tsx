import Link from "next/link";

/**
 * Replaces Next.js's default 404 (Phase O: it was nearly illegible — faint
 * gray text on the canvas background, no branding, no way back into the
 * app) with something that actually looks like Fable. Server component —
 * no client state needed, this only ever renders for a route that
 * genuinely doesn't exist or a resource `notFound()` was called on.
 */
export default function NotFound() {
  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-6 text-center">
      <p className="text-xs font-medium uppercase tracking-wide text-muted">404</p>
      <h1 className="mt-3 font-serif text-[26px] tracking-tight text-ink">
        This page doesn&apos;t exist.
      </h1>
      <p className="mt-2 text-sm text-muted">
        It may have been moved, deleted, or the link might just be wrong.
      </p>
      <Link href="/app" className="btn-primary mt-6">
        Back to your dashboard
      </Link>
    </div>
  );
}
