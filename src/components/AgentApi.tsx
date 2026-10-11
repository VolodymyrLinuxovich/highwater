"use client";

import { useCallback, useEffect, useState } from "react";

type Status = {
  enabled: boolean;
  network: string;
  asset: string;
  payTo: string | null;
  prices: { forecast: number; board: number };
  demoAgent: boolean;
  revenue: number;
  payments: { from: string; value: number; tx: string; at: string }[];
  error: string | null;
};
type Contract = { label: string; fair: number; status: string };
type Run = {
  status: number;
  ms: number;
  payment: { transaction: string; payer: string } | null;
  forecast: { name: string; observedMax: number | null; median: number; range80: [number, number]; contracts: Contract[] } | null;
  error: unknown;
};

const SCAN = "https://sepolia.basescan.org";
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const CITIES = ["NYC", "CHI", "MIA", "LA", "DEN", "SEA", "BOS", "PHX"];

export default function AgentApi() {
  const [status, setStatus] = useState<Status | null>(null);
  const [city, setCity] = useState("NYC");
  const [run, setRun] = useState<Run | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/x402/status", { cache: "no-store" });
      setStatus(await r.json());
    } catch {
      /* keep the last status */
    }
  }, []);

  useEffect(() => {
    const first = setTimeout(load, 0);
    const id = setInterval(load, 15_000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [load]);

  async function runAgent() {
    setBusy(true);
    setRun(null);
    try {
      const r = await fetch("/api/x402/demo-agent", { method: "POST", body: JSON.stringify({ city }) });
      setRun(await r.json());
      setTimeout(load, 3000);
    } finally {
      setBusy(false);
    }
  }

  if (!status) return null;
  const lead = run?.forecast ? [...run.forecast.contracts].sort((a, b) => b.fair - a.fair)[0] : null;

  return (
    <section className="mt-14">
      <h2 className="text-lg font-semibold tracking-tight">Agent API: pay per forecast in AUSD</h2>
      <p className="mt-1 max-w-3xl text-sm text-muted">
        Trading bots don&apos;t want a subscription; they want one number right before they quote. Every forecast is sold over{" "}
        <span className="text-foreground">x402</span>: the endpoint answers <span className="num">402 Payment Required</span>, the
        agent signs a gasless AUSD transfer (ERC-3009), and Highwater settles it on Base Sepolia before returning the data.
      </p>

      <div className="mt-4 grid gap-3 lg:grid-cols-[1.2fr_1fr]">
        <div className="rounded-xl border border-line bg-panel p-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <Endpoint path="/api/paid/forecast?city=NYC" price={status.prices.forecast} what="one city: distribution, fair values, book" />
            <Endpoint path="/api/paid/board" price={status.prices.board} what="all 49 cities" />
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-2">
            <select
              value={city}
              onChange={(e) => setCity(e.target.value)}
              className="rounded-md border border-line bg-background px-2 py-1.5 text-sm"
            >
              {CITIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
            <button
              onClick={runAgent}
              disabled={busy || !status.enabled || !status.demoAgent}
              className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-background disabled:opacity-40"
            >
              {busy ? "Agent is paying…" : `Run the demo agent: buy ${city} for ${status.prices.forecast} AUSD`}
            </button>
          </div>
          {!status.enabled && <p className="mt-2 text-xs text-muted">Payments are not configured on this deployment.</p>}

          {run && (
            <div className={`mt-4 rounded-lg border p-3 text-sm ${run.payment ? "border-good/40 bg-good/5" : "border-bad/40 bg-bad/5"}`}>
              {run.payment && run.forecast ? (
                <>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="text-good">Paid and served in {(run.ms / 1000).toFixed(1)}s</span>
                    <a className="num text-cool underline" href={`${SCAN}/tx/${run.payment.transaction}`} target="_blank" rel="noreferrer">
                      tx {short(run.payment.transaction)}
                    </a>
                    <span className="num text-muted">from {short(run.payment.payer)}</span>
                  </div>
                  <div className="mt-2 text-muted">
                    {run.forecast.name}: high so far <span className="num text-foreground">{run.forecast.observedMax}°</span>, median{" "}
                    <span className="num text-foreground">{run.forecast.median}°</span>
                    {lead && (
                      <>
                        , leading contract <span className="text-foreground">{lead.label}</span> at{" "}
                        <span className="num text-accent">{Math.round(lead.fair * 100)}%</span>
                      </>
                    )}
                  </div>
                </>
              ) : (
                <span className="text-bad">Agent call failed: {JSON.stringify(run.error).slice(0, 240)}</span>
              )}
            </div>
          )}
        </div>

        <div className="rounded-xl border border-line bg-panel p-5">
          <div className="flex items-baseline justify-between">
            <div>
              <div className="num text-2xl font-semibold text-good">{status.revenue.toFixed(3)} AUSD</div>
              <div className="text-xs text-muted">
                earned on-chain by treasury{" "}
                {status.payTo && (
                  <a className="num text-cool underline" href={`${SCAN}/address/${status.payTo}`} target="_blank" rel="noreferrer">
                    {short(status.payTo)}
                  </a>
                )}
              </div>
            </div>
            <span className="text-xs text-muted">{status.payments.length} payments</span>
          </div>
          <div className="mt-3 space-y-1.5 text-xs">
            {status.payments.slice(0, 6).map((p) => (
              <div key={p.tx} className="flex items-center justify-between gap-2 border-t border-line/60 pt-1.5">
                <a className="num text-cool underline" href={`${SCAN}/tx/${p.tx}`} target="_blank" rel="noreferrer">
                  {short(p.tx)}
                </a>
                <span className="num text-muted">{short(p.from)}</span>
                <span className="num">{p.value} AUSD</span>
                <span className="num text-muted">{new Date(p.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>
              </div>
            ))}
            {status.payments.length === 0 && <p className="text-muted">No payments yet. Run the agent to make the first one.</p>}
          </div>
        </div>
      </div>
    </section>
  );
}

function Endpoint({ path, price, what }: { path: string; price: number; what: string }) {
  return (
    <div className="rounded-lg bg-background p-3">
      <div className="num text-xs text-cool">GET {path}</div>
      <div className="mt-1 flex items-baseline justify-between gap-2">
        <span className="text-xs text-muted">{what}</span>
        <span className="num text-sm font-semibold">{price} AUSD</span>
      </div>
    </div>
  );
}
