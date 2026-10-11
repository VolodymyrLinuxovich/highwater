import { createWalletClient, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { decodeXPaymentResponse, wrapFetchWithPayment } from "x402-fetch";

// A stand-in trading agent: buys one forecast with a stock x402 client,
// paying from its own wallet, exactly as an outside agent would.
export async function POST(req: Request) {
  const key = process.env.AGENT_KEY as Hex | undefined;
  if (!key) return Response.json({ error: "demo agent wallet is not configured" }, { status: 503 });
  const { city = "NYC" } = (await req.json().catch(() => ({}))) as { city?: string };
  const wallet = createWalletClient({ account: privateKeyToAccount(key), chain: baseSepolia, transport: http(process.env.BASE_SEPOLIA_RPC ?? "https://sepolia.base.org") });
  const pay = wrapFetchWithPayment(fetch, wallet as never, BigInt(10_000)); // spend cap: 0.01 AUSD per call
  const origin = new URL(req.url).origin;
  const started = Date.now();
  const r = await pay(`${origin}/api/paid/forecast?city=${encodeURIComponent(city)}`);
  const body = await r.json();
  const header = r.headers.get("x-payment-response");
  return Response.json(
    {
      status: r.status,
      ms: Date.now() - started,
      payment: header ? decodeXPaymentResponse(header) : null,
      forecast: r.ok ? body : null,
      error: r.ok ? null : body,
    },
    { status: r.ok ? 200 : 502 },
  );
}
