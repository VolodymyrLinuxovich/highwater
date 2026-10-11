import type { Metadata } from "next";
import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import SandboxDesk from "@/components/SandboxDesk";

export const metadata: Metadata = { title: "Labs · Highwater" };

export default function LabsPage() {
  return (
    <>
      <PageHeader eyebrow="Labs · experiment" title="Crypto contracts in Gemini's sandbox">
        Not part of the weather product. Gemini&apos;s sandbox lists crypto price contracts but no weather markets, so this
        experiment applies the same &ldquo;where will it land at expiry&rdquo; question to them, using Gemini spot prices and
        2-hour realized volatility.
      </PageHeader>
      <div className="mb-6 rounded-xl border border-line bg-panel-2 p-4 text-sm text-muted">
        Sandbox data uses test funds and can be unavailable. Order buttons only work where a Gemini sandbox API key is
        configured; otherwise they stay disabled. Looking for weather? <Link href="/board" className="text-accent hover:underline">Open the live board</Link>.
      </div>
      <SandboxDesk />
    </>
  );
}
