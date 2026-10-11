import { getPositions } from "@/lib/gemini-trade";

export async function GET() {
  try {
    return Response.json({ positions: await getPositions() });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 502 });
  }
}
