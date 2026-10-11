import type { Metadata } from "next";
import Board from "@/components/Board";
import PaperBook from "@/components/PaperBook";

export const metadata: Metadata = { title: "Live board · Highwater" };

export default function BoardPage() {
  return (
    <>
      <Board />
      <PaperBook />
    </>
  );
}
