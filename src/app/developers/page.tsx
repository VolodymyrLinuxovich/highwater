import type { Metadata } from "next";
import AgentApi from "@/components/AgentApi";
import PageHeader, { SectionTitle } from "@/components/PageHeader";
import { PRICE_BOARD, PRICE_FORECAST } from "@/lib/paid";
import { PARAMS } from "@/lib/params";
import { AUSD, NETWORK } from "@/lib/x402";

export const metadata: Metadata = { title: "For developers · Highwater" };

const STEPS = [
  ["Ask", "Call a paid endpoint without payment. It answers 402 Payment Required with standard x402 v1 requirements."],
  ["Sign", "The agent signs an ERC-3009 TransferWithAuthorization for the price in AUSD. It needs no ETH, only AUSD."],
  ["Verify", "Highwater checks the signature, recipient, amount, validity window, unused nonce and the payer's balance."],
  ["Settle", "Highwater submits the transfer on Base Sepolia, waits for the receipt, and returns the data with X-PAYMENT-RESPONSE."],
];

const FIELDS = [
  ["observedMax", "Highest temperature reported so far today (°F)"],
  ["median, range80", "Median and 80% range of the final official high (°F)"],
  ["distribution", "Probability of each whole-degree final high"],
  ["contracts[].fair", "Probability that each Gemini contract settles YES"],
  ["contracts[].status", "live, locked (≥ 97%) or dead (already impossible)"],
  ["contracts[].quote", "Highwater's two-sided quote"],
  ["contracts[].market, edge", "Gemini's current book, and a flag when it is 5¢ or more from fair"],
];

const CLIENT = `import { wrapFetchWithPayment, decodeXPaymentResponse } from "x402-fetch";

// wallet: a viem wallet client on Base Sepolia holding AUSD
const pay = wrapFetchWithPayment(fetch, wallet, 10_000n); // cap: 0.01 AUSD per call
const r = await pay("https://highwater-tau.vercel.app/api/paid/forecast?city=NYC");
const forecast = await r.json();
const receipt = decodeXPaymentResponse(r.headers.get("x-payment-response")!);`;

export default function DevelopersPage() {
  return (
    <>
      <PageHeader eyebrow="For developers" title="Buy a forecast per call">
        Trading bots don&apos;t want a subscription; they want one number right before they quote. Highwater sells each forecast
        over x402, paid in Agora&apos;s AUSD on Base Sepolia (testnet). Any standard x402 client works.
      </PageHeader>

      <AgentApi />

      <SectionTitle title="How a paid call works" />
      <ol className="grid gap-3 md:grid-cols-4">
        {STEPS.map(([t, b], i) => (
          <li key={t} className="rounded-2xl border border-line bg-panel p-5">
            <div className="num text-xs text-accent">0{i + 1}</div>
            <div className="mt-1 font-medium">{t}</div>
            <p className="mt-1.5 text-sm leading-relaxed text-muted">{b}</p>
          </li>
        ))}
      </ol>

      <SectionTitle title="Reference" />
      <div className="grid gap-3 lg:grid-cols-2">
        <div className="rounded-2xl border border-line bg-panel p-5">
          <h3 className="font-medium">Endpoints</h3>
          <div className="mt-3 space-y-2 text-sm">
            <div className="flex items-center justify-between gap-3 rounded-lg bg-background p-3">
              <code className="num text-cool">GET /api/paid/forecast?city=NYC</code>
              <span className="num shrink-0 font-semibold">{PRICE_FORECAST} AUSD</span>
            </div>
            <div className="flex items-center justify-between gap-3 rounded-lg bg-background p-3">
              <code className="num text-cool">GET /api/paid/board</code>
              <span className="num shrink-0 font-semibold">{PRICE_BOARD} AUSD</span>
            </div>
          </div>
          <dl className="mt-4 grid grid-cols-[110px_1fr] gap-y-1.5 text-xs">
            <dt className="text-muted">Scheme</dt>
            <dd className="num">exact (x402 v1)</dd>
            <dt className="text-muted">Network</dt>
            <dd className="num">{NETWORK}</dd>
            <dt className="text-muted">Asset</dt>
            <dd className="num break-all">AUSD {AUSD}</dd>
            <dt className="text-muted">EIP-712 domain</dt>
            <dd className="num">Agora Dollar / 1</dd>
          </dl>
          <h3 className="mt-5 font-medium">Response fields</h3>
          <table className="mt-2 w-full text-xs">
            <tbody>
              {FIELDS.map(([k, v]) => (
                <tr key={k} className="border-t border-line/60">
                  <td className="num py-2 pr-3 align-top text-cool">{k}</td>
                  <td className="py-2 text-muted">{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="min-w-0 rounded-2xl border border-line bg-panel p-5">
          <h3 className="font-medium">Client</h3>
          <pre className="mt-3 overflow-x-auto rounded-lg bg-background p-4 text-xs leading-relaxed text-muted">
            <code>{CLIENT}</code>
          </pre>
          <h3 className="mt-5 font-medium">From the repository</h3>
          <pre className="mt-3 overflow-x-auto rounded-lg bg-background p-4 text-xs leading-relaxed text-muted">
            <code>{`# faucet AUSD to the demo agent (relayer pays gas)
npx tsx --env-file=.env.local scripts/fund-agent.ts

# trading agent: buys forecasts, flags mispriced contracts
npx tsx --env-file=.env.local scripts/agent.ts <baseUrl> NYC CHI MIA`}</code>
          </pre>
          <p className="mt-3 text-xs text-muted">
            The free board data the site itself uses is at <code className="num text-cool">GET /api/board</code>.
          </p>
        </div>
      </div>

      <SectionTitle title="Model details">
        The live engine&apos;s parameters, taken from <span className="num">src/lib/params.ts</span>.
      </SectionTitle>
      <div className="grid gap-3 text-sm leading-relaxed text-muted md:grid-cols-3">
        <div className="rounded-2xl border border-line bg-panel p-5">
          <h3 className="font-medium text-foreground">The floor</h3>
          <p className="mt-1.5">
            Gemini settles on the NWS Daily Climate Report, a midnight-to-midnight window in local <em>standard</em> time. Every
            METAR since then, plus the 6-hour maximum groups, gives the high so far, rounded down.
          </p>
        </div>
        <div className="rounded-2xl border border-line bg-panel p-5">
          <h3 className="font-medium text-foreground">The rest of the day</h3>
          <p className="mt-1.5">
            82 ensemble members (GFS + ECMWF) shifted by today&apos;s observed forecast error ({PARAMS.biasHalfLifeHours}h
            half-life). Error grows with lead time: {PARAMS.noiseBase}°F + {PARAMS.noiseSlope}°F per hour, capped at{" "}
            {PARAMS.noiseCap}°F.
          </p>
        </div>
        <div className="rounded-2xl border border-line bg-panel p-5">
          <h3 className="font-medium text-foreground">Pricing</h3>
          <p className="mt-1.5">
            Final high = max(high so far + unobserved peak, hottest remaining hour), simulated and rounded to whole °F. Blends
            from forecast-only at {PARAMS.blendStartHour}:00 to the full nowcast at {PARAMS.blendEndHour}:00. Parameters:{" "}
            {PARAMS.source}.
          </p>
        </div>
      </div>
    </>
  );
}
