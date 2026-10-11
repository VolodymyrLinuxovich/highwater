"use client";

import { useEffect, useState } from "react";

// Fires once when the element scrolls into view.
export function useInView<T extends Element>(margin = "0px 0px -12% 0px") {
  const [el, ref] = useState<T | null>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    if (!el || seen) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setSeen(true);
          io.disconnect();
        }
      },
      { rootMargin: margin },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [el, margin, seen]);
  return { ref, seen };
}

// Fades and lifts its children into place the first time they scroll into view.
export function Reveal({ children, delay = 0, className = "" }: { children: React.ReactNode; delay?: number; className?: string }) {
  const { ref, seen } = useInView<HTMLDivElement>();
  return (
    <div ref={ref} className={`reveal ${seen ? "is-visible" : ""} ${className}`} style={{ transitionDelay: `${delay}ms` }}>
      {children}
    </div>
  );
}

// A hairline that draws across between sections.
export function Rule({ className = "" }: { className?: string }) {
  const { ref, seen } = useInView<HTMLDivElement>("0px 0px -5% 0px");
  return <div ref={ref} aria-hidden className={`rule ${seen ? "is-visible" : ""} ${className}`} />;
}

// Counts every number inside a string (e.g. "2,345/2,345") up from zero once visible.
export function CountUp({ value, duration = 1400 }: { value: string; duration?: number }) {
  const { ref, seen } = useInView<HTMLSpanElement>();
  const [t, setT] = useState(0);

  useEffect(() => {
    if (!seen) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const id = requestAnimationFrame(() => setT(1));
      return () => cancelAnimationFrame(id);
    }
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / duration);
      setT(1 - Math.pow(1 - p, 3));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    // If frames are throttled (background tab, some headless browsers), land on the real value anyway.
    const done = setTimeout(() => setT(1), duration + 250);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(done);
    };
  }, [seen, duration]);

  // Before it runs (and without JS) the final value is shown, so nothing renders as zero by accident.
  const shown =
    !seen || t >= 1
      ? value
      : value.replace(/\d[\d,]*/g, (m) => {
          const n = Number(m.replace(/,/g, ""));
          const v = Math.round(n * t);
          return m.includes(",") ? v.toLocaleString("en-US") : String(v);
        });

  return (
    <span ref={ref} className="tabular-nums">
      {shown}
    </span>
  );
}
