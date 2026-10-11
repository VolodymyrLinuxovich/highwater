"use client";

import { useCallback, useEffect, useState } from "react";
import type { CryptoEvent } from "@/lib/crypto";

type Desk = { tradingEnabled: boolean; events: CryptoEvent[]; staleSince?: number | null; orders: unknown; ordersError: string | null; error?: string };
type Placed = { label: string; event: string; side: string; outcome: string; price: number; fair: number; gap: number; ok: boolean; order?: { orderId?: number; status?: string }; error?: string };

const pct = (p: number) => `${Math.round(p * 100)}%`;
const cents = (p: number | null) => (p == null ? "—" : `${Math.round(p * 100)}¢`);

export default function SandboxDesk() {
  const [desk, setDesk] = useState<Desk | null>(null);
  const [placed, setPlaced] = useState<Placed[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/sandbox", { cache: "no-store" });
      setDesk(await r.json());
    } catch (e) {
      setDesk({ tradingEnabled: false, events: [], orders: null, ordersError: null, error: String(e) });
    }
  }, []);

  useEffect(() => {
    const first = setTimeout(load, 0);
    const id = setInterval(load, 20_000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [load]);

  async function trade() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/api/sandbox/trade", { method: "POST", body: JSON.stringify({ quantity: 1 }) });
      const j = await r.json();
      if (j.error) setMsg(j.error);
      setPlaced(j.placed ?? []);
      if (j.placed?.length === 0) setMsg("No gaps of 4¢ or more right now.");
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function cancelAll() {
    setBusy(true);
    try {
      const r = await fetch("/api/sandbox/cancel", { method: "POST" });
      const j = await r.json();
      setMsg(j.error ?? `Cancelled ${j.cancelled?.length ?? 0} orders.`);
      await load();
    } finally {
      setBusy(false);
    }
  }

  if (!desk) return null;
  const events = (desk.events ?? []).filter((e) => e.quotes.some((q) => q.market.bid != null || q.market.ask != null)).slice(0, 6);
  const orders = Array.isArray(desk.orders) ? desk.orders : ((desk.orders as { orders?: unknown[] } | null)?.orders ?? []);

  return (
    <section className="mt-14">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Sandbox desk: live orders on Gemini</h2>
          <p className="mt-1 max-w-2xl text-sm text-muted">
            Gemini&apos;s sandbox lists crypto price contracts, not weather. The same &ldquo;where will it land&rdquo; engine prices
            them from Gemini spot and 2-hour realized volatility, then trades the gaps with real sandbox orders.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            disabled={!desk.tradingEnabled || busy}
            onClick={trade}
            className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-background disabled:opacity-40"
          >
            {busy ? "Working…" : "Trade the gaps"}
          </button>
          <button
            disabled={!desk.tradingEnabled || busy}
            onClick={cancelAll}
            className="rounded-md border border-line px-3 py-1.5 text-sm text-muted hover:text-foreground disabled:opacity-40"
          >
            Cancel all
          </button>
        </div>
      </div>
      {desk.error && <p className="mt-2 text-sm text-bad">Gemini sandbox unavailable right now ({desk.error.replace("Error: ", "")}). Retrying every 20s.</p>}
      {desk.staleSince && (
        <p className="mt-2 text-sm text-muted">Sandbox not responding; showing prices from {new Date(desk.staleSince).toLocaleTimeString()}.</p>
      )}
      {!desk.tradingEnabled && <p className="mt-2 text-xs text-muted">Trading is off: no sandbox API key configured on this deployment.</p>}
      {msg && <p className="mt-2 text-sm text-accent">{msg}</p>}

      {placed && placed.length > 0 && (
        <div className="mt-3 rounded-lg border border-accent/40 bg-accent/5 p-3 text-sm">
          {placed.map((p, i) => (
            <div key={i} className="num flex flex-wrap gap-x-3">
              <span className={p.ok ? "text-good" : "text-bad"}>{p.ok ? "✓" : "✗"}</span>
              <span>
                {p.side} {p.outcome.toUpperCase()} {p.event} · {p.label} @ {cents(p.price)}
              </span>
              <span className="text-muted">
                fair {pct(p.fair)} · gap {Math.round(p.gap * 100)}¢
              </span>
              <span className="text-muted">{p.ok ? `order ${p.order?.orderId ?? "?"} ${p.order?.status ?? ""}` : p.error}</span>
            </div>
          ))}
        </div>
      )}

      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {events.map((e) => (
          <div key={e.ticker} className="rounded-xl border border-line bg-panel p-4">
            <div className="flex justify-between">
              <div className="font-medium">{e.title}</div>
              <div className="num text-xs text-muted">{e.minutesLeft.toFixed(0)} min</div>
            </div>
            <div className="num text-xs text-muted">
              spot {e.spot.toLocaleString(undefined, { maximumFractionDigits: e.spot > 100 ? 0 : 3 })} · σ{" "}
              {(e.volPerSqrtMin * 1e4).toFixed(1)} bp/√min
            </div>
            <table className="mt-2 w-full text-xs">
              <thead className="text-muted">
                <tr>
                  <th className="text-left font-normal">Strike</th>
                  <th className="text-right font-normal">Fair</th>
                  <th className="text-right font-normal">Bid / ask</th>
                  <th className="text-right font-normal">Gap</th>
                </tr>
              </thead>
              <tbody>
                {e.quotes.map((q) => (
                  <tr key={q.symbol}>
                    <td className="num">{q.label.replace(" or above", "+")}</td>
                    <td className="num text-right text-accent">{pct(q.fair)}</td>
                    <td className="num text-right text-muted">
                      {cents(q.market.bid)} / {cents(q.market.ask)}
                    </td>
                    <td className={`num text-right ${q.edge != null && Math.abs(q.edge) >= 0.04 ? "text-foreground" : "text-muted"}`}>
                      {q.edge == null ? "—" : `${q.edge > 0 ? "+" : ""}${Math.round(q.edge * 100)}¢`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>

      {desk.tradingEnabled && (
        <p className="mt-3 text-xs text-muted">
          {desk.ordersError ? `Orders: ${desk.ordersError}` : `${orders.length} active sandbox orders`}
        </p>
      )}
    </section>
  );
}
