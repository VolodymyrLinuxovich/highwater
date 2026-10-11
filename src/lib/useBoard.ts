"use client";

import { useCallback, useEffect, useState } from "react";
import type { Board } from "./board";

export type BoardPayload = Board & { dates: string[]; error?: string };

// Several components on one page read the board; share one request per date.
const inflight = new Map<string, { at: number; p: Promise<BoardPayload> }>();

function fetchBoard(date: string | null, force = false) {
  const key = date ?? "";
  const hit = inflight.get(key);
  if (!force && hit && Date.now() - hit.at < 30_000) return hit.p;
  const p = fetch(`/api/board${date ? `?date=${date}` : ""}`, { cache: "no-store" }).then((r) => r.json() as Promise<BoardPayload>);
  inflight.set(key, { at: Date.now(), p });
  p.catch(() => inflight.delete(key));
  return p;
}

// Live board data from /api/board, refreshed every minute.
export function useBoard(date: string | null = null) {
  const [data, setData] = useState<BoardPayload | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (force = false) => {
    setLoading(true);
    try {
      setData(await fetchBoard(date, force));
    } catch (e) {
      setData((d) => d ?? ({ error: String(e) } as BoardPayload));
    } finally {
      setLoading(false);
    }
  }, [date]);

  useEffect(() => {
    const first = setTimeout(() => load(), 0);
    const id = setInterval(() => load(), 60_000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [load]);

  const refresh = useCallback(() => load(true), [load]);
  return { data, loading, refresh };
}
