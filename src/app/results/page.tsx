import type { Metadata } from "next";
import Backtest from "@/components/Backtest";
import PageHeader from "@/components/PageHeader";

export const metadata: Metadata = { title: "Results · Highwater" };

export default function ResultsPage() {
  return (
    <>
      <PageHeader eyebrow="Results" title="Does it work?">
        We replayed real Gemini markets that already settled, using only what was known at the time.
      </PageHeader>
      <Backtest />
    </>
  );
}
