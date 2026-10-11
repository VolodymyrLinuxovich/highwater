import { createPublicClient, createWalletClient, getAddress, http, parseAbi, parseSignature, verifyTypedData, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

// x402 ("exact" scheme, v1 wire format) paid in AUSD on Base Sepolia.
// AUSD implements ERC-3009, so the payer only signs; our relayer submits
// transferWithAuthorization and pays the gas.

export const AUSD = getAddress("0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC");
export const AUSD_FAUCET = getAddress("0xd236c18D274E54FAccC3dd9DDA4b27965a73ee6C");
export const AUSD_DECIMALS = 6;
export const NETWORK = "base-sepolia";
const DOMAIN = { name: "Agora Dollar", version: "1", chainId: baseSepolia.id, verifyingContract: AUSD } as const;

export const ausdAbi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function authorizationState(address authorizer, bytes32 nonce) view returns (bool)",
  "function transferWithAuthorization(address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, uint8 v, bytes32 r, bytes32 s)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
]);
export const faucetAbi = parseAbi(["function requestFunds(address to)"]);

const authorizationTypes = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

const RPC = process.env.BASE_SEPOLIA_RPC ?? "https://sepolia.base.org";
export const publicClient = createPublicClient({ chain: baseSepolia, transport: http(RPC) });

export const payTo = () => (process.env.X402_PAY_TO ? getAddress(process.env.X402_PAY_TO) : null);
export const x402Enabled = () => Boolean(process.env.X402_PAY_TO && process.env.X402_RELAYER_KEY);

export const toUnits = (ausd: number) => BigInt(Math.round(ausd * 10 ** AUSD_DECIMALS));
export const fromUnits = (u: bigint) => Number(u) / 10 ** AUSD_DECIMALS;

export type Requirements = {
  scheme: "exact";
  network: typeof NETWORK;
  maxAmountRequired: string;
  resource: string;
  description: string;
  mimeType: string;
  payTo: string;
  maxTimeoutSeconds: number;
  asset: string;
  extra: { name: string; version: string };
};

export function requirements(resource: string, price: number, description: string): Requirements {
  return {
    scheme: "exact",
    network: NETWORK,
    maxAmountRequired: toUnits(price).toString(),
    resource,
    description,
    mimeType: "application/json",
    payTo: payTo()!,
    maxTimeoutSeconds: 120,
    asset: AUSD,
    extra: { name: DOMAIN.name, version: DOMAIN.version },
  };
}

type Payment = {
  x402Version: number;
  scheme: string;
  network: string;
  payload: {
    signature: Hex;
    authorization: { from: string; to: string; value: string; validAfter: string; validBefore: string; nonce: Hex };
  };
};

export function decodePayment(header: string): Payment {
  return JSON.parse(Buffer.from(header, "base64").toString("utf8"));
}

// Everything a facilitator's /verify would check, done locally against chain state.
export async function verify(p: Payment, req: Requirements): Promise<{ ok: true; payer: string } | { ok: false; reason: string }> {
  if (p.scheme !== "exact" || p.network !== NETWORK) return { ok: false, reason: "unsupported scheme or network" };
  const a = p.payload?.authorization;
  if (!a || !p.payload.signature) return { ok: false, reason: "missing authorization" };
  if (getAddress(a.to) !== getAddress(req.payTo)) return { ok: false, reason: "wrong recipient" };
  if (BigInt(a.value) < BigInt(req.maxAmountRequired)) return { ok: false, reason: "amount below price" };
  const now = BigInt(Math.floor(Date.now() / 1000));
  if (BigInt(a.validAfter) > now) return { ok: false, reason: "authorization not yet valid" };
  if (BigInt(a.validBefore) < now + BigInt(6)) return { ok: false, reason: "authorization expired" };
  const message = {
    from: getAddress(a.from),
    to: getAddress(a.to),
    value: BigInt(a.value),
    validAfter: BigInt(a.validAfter),
    validBefore: BigInt(a.validBefore),
    nonce: a.nonce,
  };
  const valid = await verifyTypedData({
    address: message.from,
    domain: DOMAIN,
    types: authorizationTypes,
    primaryType: "TransferWithAuthorization",
    message,
    signature: p.payload.signature,
  });
  if (!valid) return { ok: false, reason: "bad signature" };
  const [balance, used] = await Promise.all([
    publicClient.readContract({ address: AUSD, abi: ausdAbi, functionName: "balanceOf", args: [message.from] }),
    publicClient.readContract({ address: AUSD, abi: ausdAbi, functionName: "authorizationState", args: [message.from, a.nonce] }),
  ]);
  if (used) return { ok: false, reason: "authorization already used" };
  if (balance < message.value) return { ok: false, reason: "insufficient AUSD balance" };
  return { ok: true, payer: message.from };
}

// The facilitator's /settle: submit the signed transfer and wait for it to land.
export async function settle(p: Payment) {
  const account = privateKeyToAccount(process.env.X402_RELAYER_KEY as Hex);
  const wallet = createWalletClient({ account, chain: baseSepolia, transport: http(RPC) });
  const a = p.payload.authorization;
  const { r, s, v, yParity } = parseSignature(p.payload.signature);
  const hash = await wallet.writeContract({
    address: AUSD,
    abi: ausdAbi,
    functionName: "transferWithAuthorization",
    args: [
      getAddress(a.from),
      getAddress(a.to),
      BigInt(a.value),
      BigInt(a.validAfter),
      BigInt(a.validBefore),
      a.nonce,
      Number(v ?? BigInt(yParity + 27)),
      r,
      s,
    ],
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 30_000 });
  return { hash, success: receipt.status === "success" };
}

// Wraps a handler in an x402 paywall. Unpaid requests get 402 + requirements.
export async function paywall(
  req: Request,
  price: number,
  description: string,
  serve: () => Promise<unknown>,
): Promise<Response> {
  if (!x402Enabled()) return Response.json({ error: "x402 is not configured on this deployment" }, { status: 503 });
  const url = new URL(req.url);
  const reqs = requirements(`${url.origin}${url.pathname}${url.search}`, price, description);
  const header = req.headers.get("x-payment");
  const ask = (error: string) => Response.json({ x402Version: 1, error, accepts: [reqs] }, { status: 402 });
  if (!header) return ask("X-PAYMENT header is required");
  let payment: Payment;
  try {
    payment = decodePayment(header);
  } catch {
    return ask("malformed X-PAYMENT header");
  }
  const v = await verify(payment, reqs);
  if (!v.ok) return ask(v.reason);
  const body = await serve();
  const settled = await settle(payment).catch((e) => ({ hash: null, success: false, error: String(e) }));
  if (!settled.success) return ask(`settlement failed${"error" in settled ? `: ${settled.error}` : ""}`);
  const receipt = Buffer.from(
    JSON.stringify({ success: true, transaction: settled.hash, network: NETWORK, payer: v.payer }),
  ).toString("base64");
  return Response.json(body, { headers: { "X-PAYMENT-RESPONSE": receipt, "Access-Control-Expose-Headers": "X-PAYMENT-RESPONSE" } });
}

// Recent AUSD payments into the treasury. The public RPC caps eth_getLogs at
// 200 blocks, so read the indexed history from Base Sepolia's Blockscout.
type BlockscoutTransfer = {
  transaction_hash: string;
  timestamp: string;
  from: { hash: string };
  to: { hash: string };
  token: { address_hash?: string; address?: string };
  total: { value: string; decimals: string };
};

export async function recentPayments() {
  const to = payTo();
  if (!to) return [];
  const r = await fetch(
    `https://base-sepolia.blockscout.com/api/v2/addresses/${to}/token-transfers?type=ERC-20&filter=to&token=${AUSD}`,
    { cache: "no-store", signal: AbortSignal.timeout(10_000) },
  );
  if (!r.ok) throw new Error(`blockscout: HTTP ${r.status}`);
  const { items } = (await r.json()) as { items: BlockscoutTransfer[] };
  return items
    .filter((t) => getAddress(t.to.hash) === to && getAddress(t.token.address_hash ?? t.token.address ?? "0x0000000000000000000000000000000000000000") === AUSD)
    .map((t) => ({
      from: t.from.hash,
      value: Number(t.total.value) / 10 ** Number(t.total.decimals),
      tx: t.transaction_hash,
      at: t.timestamp,
    }));
}
