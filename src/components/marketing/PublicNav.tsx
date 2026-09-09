"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { LogoMark } from "@/components/icons";

const LINKS = [
  { href: "#product", label: "Product" },
  { href: "#how-it-works", label: "How it works" },
  { href: "#security", label: "Security" },
  { href: "#pricing", label: "Pricing" },
];

/**
 * Sticky marketing nav. Compacts (shorter, hairline border appears) once
 * the page scrolls past the hero — a small, purposeful motion rather than
 * decoration. Mobile collapses into a single full-screen sheet, not a
 * hamburger-into-dropdown that clips.
 */
export default function PublicNav() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (open) document.body.style.overflow = "hidden";
    else document.body.style.overflow = "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <header
      className={`sticky top-0 z-40 border-b bg-canvas/90 backdrop-blur transition-[padding,border-color] duration-200 ${
        scrolled ? "border-line py-3" : "border-transparent py-5"
      }`}
    >
      <div className="mx-auto flex max-w-6xl items-center justify-between px-5 md:px-10">
        <Link href="/" className="flex items-center gap-2" onClick={() => setOpen(false)}>
          <LogoMark className="text-ink" />
          <span className="text-[15px] font-semibold tracking-tight text-ink">Fable</span>
        </Link>

        <nav className="hidden items-center gap-8 md:flex" aria-label="Primary">
          {LINKS.map((l) => (
            <a key={l.href} href={l.href} className="text-sm text-muted transition-colors hover:text-ink">
              {l.label}
            </a>
          ))}
        </nav>

        <div className="hidden items-center gap-3 md:flex">
          <Link href="/login" className="btn-ghost">
            Sign in
          </Link>
          <Link href="/signup" className="btn-primary">
            Get started
          </Link>
        </div>

        <button
          type="button"
          className="flex items-center gap-1.5 text-sm font-medium text-ink md:hidden"
          aria-expanded={open}
          aria-controls="mobile-nav"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? "Close" : "Menu"}
        </button>
      </div>

      {open && (
        <div id="mobile-nav" className="fixed inset-x-0 top-[57px] bottom-0 z-30 bg-canvas md:hidden">
          <nav className="flex flex-col gap-1 px-5 pt-4" aria-label="Primary">
            {LINKS.map((l) => (
              <a
                key={l.href}
                href={l.href}
                onClick={() => setOpen(false)}
                className="border-b border-line py-4 font-serif text-xl text-ink"
              >
                {l.label}
              </a>
            ))}
            <div className="mt-6 flex flex-col gap-3">
              <Link href="/login" onClick={() => setOpen(false)} className="btn-secondary w-full">
                Sign in
              </Link>
              <Link href="/signup" onClick={() => setOpen(false)} className="btn-primary w-full">
                Get started
              </Link>
            </div>
          </nav>
        </div>
      )}
    </header>
  );
}
