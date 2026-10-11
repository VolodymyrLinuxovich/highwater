import { paperBook } from "@/lib/paper-book";

export const maxDuration = 60;

export async function GET() {
  try {
    return Response.json(await paperBook());
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 502 });
  }
}
