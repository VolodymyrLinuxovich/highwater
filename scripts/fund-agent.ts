// Claims testnet AUSD from Agora's faucet for the demo agent wallet.
// The relayer pays the gas, so it needs a little Base Sepolia ETH.
//   npx tsx --env-file=.env.local scripts/fund-agent.ts
import { createWalletClient, formatEther, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { AUSD, AUSD_FAUCET, ausdAbi, faucetAbi, fromUnits, publicClient } from "../src/lib/x402";

async function main() {
  const relayer = privateKeyToAccount(process.env.X402_RELAYER_KEY as Hex);
  const agent = privateKeyToAccount(process.env.AGENT_KEY as Hex).address;
  const eth = await publicClient.getBalance({ address: relayer.address });
  console.log(`relayer ${relayer.address}: ${formatEther(eth)} ETH`);
  if (eth === BigInt(0)) throw new Error("relayer has no Base Sepolia ETH for gas");
  const wallet = createWalletClient({ account: relayer, chain: baseSepolia, transport: http(process.env.BASE_SEPOLIA_RPC ?? "https://sepolia.base.org") });
  const hash = await wallet.writeContract({ address: AUSD_FAUCET, abi: faucetAbi, functionName: "requestFunds", args: [agent] });
  await publicClient.waitForTransactionReceipt({ hash });
  const bal = await publicClient.readContract({ address: AUSD, abi: ausdAbi, functionName: "balanceOf", args: [agent] });
  console.log(`faucet tx ${hash}`);
  console.log(`agent ${agent}: ${fromUnits(bal)} AUSD`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
