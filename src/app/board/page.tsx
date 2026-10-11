import type { Metadata } from "next";
import Board from "@/components/Board";

export const metadata: Metadata = { title: "Live board · Highwater" };

export default function BoardPage() {
  return <Board />;
}
