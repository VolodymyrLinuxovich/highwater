import type { Metadata } from "next";
import AgentApi from "@/components/AgentApi";
import { PRICE_BOARD, PRICE_FORECAST } from "@/lib/paid";
import { PARAMS } from "@/lib/params";
import { AUSD, NETWORK } from "@/lib/x402";

export const metadata: Metadata = { title: "For developers · Highwater" };

const STEPS = [
  { title: "Agent asks", body: <code className="num text-cool">GET /api/paid/forecast?city=NYC</code> },
  { title: "Gets 402", body: <>Payment Required: <span className="num text-foreground">{PRICE_FORECAST} AUSD</span></> },
  { title: "Signs", body: "A gasless AUSD transfer (ERC-3009). No ETH needed." },
  { title: "Gets the forecast", body: "Settled on Base Sepolia. Data comes back with the tx hash." },
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
      <div className="pt-14 pb-10 text-center sm:pt-20">
        <h1 className="text-4xl font-semibold tracking-tight sm:text-6xl">
          A forecast for <span className="font-serif font-normal italic text-accent">half a cent.</span>
        </h1>
        <p className="mx-auto mt-5 max-w-xl text-lg text-muted">Trading bots pay per call over x402, in AUSD. No account, no API key.</p>
      </div>

      <ol className="grid gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
        {STEPS.map((s, i) => (
          <li key={s.title} className="bg-background p-6 sm:p-8">
            <div className="num font-serif text-6xl italic leading-none text-accent">{i + 1}</div>
            <h2 className="mt-5 text-2xl font-semibold tracking-tight">{s.title}</h2>
            <p className="mt-2 text-base leading-relaxed text-muted">{s.body}</p>
          </li>
        ))}
      </ol>

      <h2 className="mt-20 text-center text-3xl font-semibold tracking-tight">Try it live</h2>
      <p className="mx-auto mt-3 max-w-lg text-center text-base text-muted">Our demo agent pays real testnet AUSD and gets the forecast.</p>
      <div className="mt-8">
        <AgentApi />
      </div>

      <details className="group mt-16 rounded-2xl border border-line bg-panel">
        <summary className="flex cursor-pointer list-none items-center justify-between p-6 text-lg font-medium">
          Technical details
          <span className="text-muted transition group-open:rotate-45">+</span>
        </summary>
        <div className="grid gap-8 border-t border-line p-6 text-sm leading-relaxed text-muted lg:grid-cols-2">
          <div>
            <h3 className="font-medium text-foreground">Endpoints</h3>
            <ul className="mt-2 space-y-1">
              <li>
                <code className="num text-cool">GET /api/paid/forecast?city=NYC</code>: {PRICE_FORECAST} AUSD, one city
              </li>
              <li>
                <code className="num text-cool">GET /api/paid/board</code>: {PRICE_BOARD} AUSD, all 49 cities
              </li>
              <li>
                <code className="num text-cool">GET /api/board</code>: free, what the site uses
              </li>
            </ul>
            <h3 className="mt-5 font-medium text-foreground">Payment</h3>
            <p className="mt-1">
              x402 v1, scheme <span className="num">exact</span>, network <span className="num">{NETWORK}</span>, asset AUSD{" "}
              <span className="num break-all">{AUSD}</span>, EIP-712 domain <span className="num">Agora Dollar / 1</span>. Highwater
              checks signature, recipient, amount, validity window, nonce and balance, then submits the transfer from its relayer.
            </p>
            <h3 className="mt-5 font-medium text-foreground">Response fields</h3>
            <table className="mt-2 w-full text-xs">
              <tbody>
                {FIELDS.map(([k, v]) => (
                  <tr key={k} className="border-t border-line/60">
                    <td className="num py-2 pr-3 align-top text-cool">{k}</td>
                    <td className="py-2">{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="min-w-0">
            <h3 className="font-medium text-foreground">Client</h3>
            <pre className="mt-2 overflow-x-auto rounded-lg bg-background p-4 text-xs leading-relaxed">
              <code>{CLIENT}</code>
            </pre>
            <h3 className="mt-5 font-medium text-foreground">From the repository</h3>
            <pre className="mt-2 overflow-x-auto rounded-lg bg-background p-4 text-xs leading-relaxed">
              <code>{`npx tsx --env-file=.env.local scripts/fund-agent.ts
npx tsx --env-file=.env.local scripts/agent.ts <baseUrl> NYC CHI MIA`}</code>
            </pre>
            <h3 className="mt-5 font-medium text-foreground">Model</h3>
            <p className="mt-1">
              Floor from every METAR since local-standard midnight, rounded down. 82 ensemble members (GFS + ECMWF) shifted by
              today&apos;s observed error ({PARAMS.biasHalfLifeHours}h half-life), with error of {PARAMS.noiseBase}°F +{" "}
              {PARAMS.noiseSlope}°F per hour (max {PARAMS.noiseCap}°F). Blends from forecast-only at {PARAMS.blendStartHour}:00 to
              the full nowcast at {PARAMS.blendEndHour}:00. Parameters: {PARAMS.source}.
            </p>
          </div>
        </div>
      </details>
    </>
  );
}
