"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

const LINKS = [
  { href: "/", label: "Overview" },
  { href: "/board", label: "Live board" },
  { href: "/results", label: "Results" },
  { href: "/developers", label: "For developers" },
  { href: "/labs", label: "Labs" },
];

export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" aria-hidden>
      <rect width="28" height="28" rx="7" fill="#141b24" />
      <path d="M4 19 Q9 13 14 17 T24 12" stroke="#4cc2ff" strokeWidth="2" fill="none" strokeLinecap="round" />
      <path d="M4 9 H24" stroke="#ff7a3d" strokeWidth="2" strokeDasharray="2 2.5" />
    </svg>
  );
}

export default function SiteNav() {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const active = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-background/85 backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-[1200px] items-center justify-between px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2.5" onClick={() => setOpen(false)}>
          <Logo />
          <span className="font-semibold tracking-tight">Highwater</span>
        </Link>
        <nav className="hidden items-center gap-1 md:flex">
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={`rounded-md px-3 py-1.5 text-sm transition ${
                active(l.href) ? "bg-panel-2 text-foreground" : "text-muted hover:text-foreground"
              }`}
            >
              {l.label}
            </Link>
          ))}
        </nav>
        <button
          className="rounded-md border border-line px-3 py-1.5 text-sm text-muted md:hidden"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label="Menu"
        >
          {open ? "Close" : "Menu"}
        </button>
      </div>
      {open && (
        <nav className="border-t border-line px-4 pb-3 md:hidden">
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              onClick={() => setOpen(false)}
              className={`block rounded-md px-3 py-2.5 text-sm ${active(l.href) ? "bg-panel-2 text-foreground" : "text-muted"}`}
            >
              {l.label}
            </Link>
          ))}
        </nav>
      )}
    </header>
  );
}
