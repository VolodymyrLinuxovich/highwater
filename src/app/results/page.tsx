import type { Metadata } from "next";
import Backtest from "@/components/Backtest";
import PageHeader from "@/components/PageHeader";

export const metadata: Metadata = { title: "Results · Highwater" };

export default function ResultsPage() {
  return (
    <>
      <PageHeader eyebrow="Results" title="Does it work?">
        We replayed past days using only the weather reports that existed at the time, then checked the probabilities against
        how Gemini actually settled. Everything below is computed by the scripts in the repository.
      </PageHeader>
      <Backtest />
    </>
  );
}
