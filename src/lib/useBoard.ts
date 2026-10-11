"use client";

import { useCallback, useEffect, useState } from "react";
import type { Board } from "./board";

export type BoardPayload = Board & { dates: string[]; error?: string };

// Live board data from /api/board, refreshed every minute.
export function useBoard(date: string | null = null) {
  const [data, setData] = useState<BoardPayload | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/board${date ? `?date=${date}` : ""}`, { cache: "no-store" });
      setData((await r.json()) as BoardPayload);
    } catch (e) {
      setData((d) => d ?? ({ error: String(e) } as BoardPayload));
    } finally {
      setLoading(false);
    }
  }, [date]);

  useEffect(() => {
    const first = setTimeout(load, 0);
    const id = setInterval(load, 60_000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [load]);

  return { data, loading, load };
}
