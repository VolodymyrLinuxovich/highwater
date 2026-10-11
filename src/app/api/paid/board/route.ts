import { buildBoard } from "@/lib/board";
import { forecastView, PRICE_BOARD } from "@/lib/paid";
import { paywall } from "@/lib/x402";

// GET /api/paid/board — x402, 0.05 AUSD on Base Sepolia
export async function GET(req: Request) {
  return paywall(req, PRICE_BOARD, "Highwater nowcasts for every Gemini daily high market", async () => {
    const board = await buildBoard();
    return { generatedAt: board.generatedAt, cities: board.cities.map(forecastView) };
  });
}
