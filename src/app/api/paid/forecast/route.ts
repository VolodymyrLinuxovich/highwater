import { cityForecast, PRICE_FORECAST } from "@/lib/paid";
import { paywall } from "@/lib/x402";

// GET /api/paid/forecast?city=NYC — x402, 0.005 AUSD on Base Sepolia
export async function GET(req: Request) {
  const city = new URL(req.url).searchParams.get("city")?.toUpperCase();
  if (!city) return Response.json({ error: "city is required, e.g. ?city=NYC" }, { status: 400 });
  const forecast = await cityForecast(city);
  if (!forecast) return Response.json({ error: `no active market for ${city}` }, { status: 404 });
  return paywall(req, PRICE_FORECAST, `Highwater nowcast for today's high in ${forecast.name}`, async () => forecast);
}
