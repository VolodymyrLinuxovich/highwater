// A trading agent that buys Highwater forecasts per call over x402 (AUSD on
// Base Sepolia) and flags Gemini contracts priced away from fair value.
//   npx tsx --env-file=.env.local scripts/agent.ts [baseUrl] [CITY ...]
import { createWalletClient, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { decodeXPaymentResponse, wrapFetchWithPayment } from "x402-fetch";

type Contract = { label: string; fair: number; status: string; market: { bid: number | null; ask: number | null; last: number | null } };
type Forecast = { name: string; observedMax: number | null; median: number; range80: [number, number]; contracts: Contract[] };

async function main() {
  const [base = "http://localhost:3456", ...cities] = process.argv.slice(2);
  const account = privateKeyToAccount(process.env.AGENT_KEY as Hex);
  const wallet = createWalletClient({ account, chain: baseSepolia, transport: http(process.env.BASE_SEPOLIA_RPC ?? "https://sepolia.base.org") });
  // Never pay more than 0.01 AUSD for a single call.
  const pay = wrapFetchWithPayment(fetch, wallet as never, BigInt(10_000));
  let spent = 0;
  for (const city of cities.length ? cities : ["NYC", "CHI", "MIA"]) {
    const r = await pay(`${base}/api/paid/forecast?city=${city}`);
    if (!r.ok) {
      console.log(`${city}: HTTP ${r.status} ${await r.text()}`);
      continue;
    }
    const f = (await r.json()) as Forecast;
    const receipt = decodeXPaymentResponse(r.headers.get("x-payment-response")!);
    spent += 0.005;
    console.log(`\n${f.name}: high so far ${f.observedMax}°F, median ${f.median}°F, 80% ${f.range80.join("-")}°F`);
    console.log(`  paid 0.005 AUSD  tx ${receipt.transaction}`);
    for (const c of f.contracts) {
      const { bid, ask } = c.market;
      const signal =
        c.status === "dead" ? "impossible"
        : ask != null && c.fair - ask >= 0.05 ? `BUY YES @ ${ask}`
        : bid != null && bid - c.fair >= 0.05 ? `SELL YES @ ${bid}`
        : "";
      console.log(`  ${c.label.padEnd(16)} fair ${(c.fair * 100).toFixed(0).padStart(3)}%  book ${bid ?? "-"}/${ask ?? "-"}  ${signal}`);
    }
  }
  console.log(`\nspent ${spent.toFixed(3)} AUSD from ${account.address}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
