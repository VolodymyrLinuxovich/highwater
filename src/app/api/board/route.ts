import { boardDates, buildBoard } from "@/lib/board";

export async function GET(req: Request) {
  const date = new URL(req.url).searchParams.get("date") ?? undefined;
  try {
    const [board, dates] = await Promise.all([buildBoard({ date }), boardDates()]);
    return Response.json({ ...board, dates });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 502 });
  }
}
