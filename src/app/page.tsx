import Link from "next/link";
import { CityPreview, EvidenceStrip } from "@/components/Landing";
import { SectionTitle } from "@/components/PageHeader";

const STEPS = [
  {
    n: "1",
    title: "Read what already happened",
    body: "Every airport weather report since local midnight gives the highest temperature so far. The official high can't finish below it, so any contract under it is already dead.",
  },
  {
    n: "2",
    title: "Forecast the rest of the day",
    body: "82 forecast runs (GFS and ECMWF) cover the remaining hours, corrected by how far off the forecast has been today.",
  },
  {
    n: "3",
    title: "Price every contract",
    body: "Thousands of simulated finishes become a probability for each of Gemini's temperature ranges, plus two-sided quotes.",
  },
];

const AREAS = [
  { href: "/board", title: "Live board", body: "All 49 cities on a map, with search and filters. Select a city for every contract's probability." },
  { href: "/results", title: "Results", body: "How the model scored on three weeks of settled Gemini temperature markets, with the caveats." },
  { href: "/developers", title: "For developers", body: "Buy a forecast per call over x402, paid in AUSD. Includes a live agent demo." },
  { href: "/labs", title: "Labs", body: "Experiments outside the weather product, like pricing Gemini's sandbox crypto contracts." },
];

export default function Home() {
  return (
    <>
      <section className="grid items-center gap-10 pt-12 pb-6 sm:pt-20 lg:grid-cols-[1.1fr_1fr] lg:gap-14">
        <div>
          <div className="text-xs font-medium uppercase tracking-wider text-accent">For Gemini&apos;s daily high temperature markets</div>
          <h1 className="mt-3 text-4xl font-semibold leading-[1.1] tracking-tight sm:text-5xl">Where will today&apos;s high land?</h1>
          <p className="mt-5 max-w-xl text-lg leading-relaxed text-muted">
            Highwater combines live weather observations with forecast ensembles to estimate the probability of every daily high
            temperature contract on Gemini, across 49 US cities, updated every minute.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/board" className="rounded-lg bg-accent px-5 py-2.5 text-sm font-semibold text-background hover:brightness-110">
              Open live board
            </Link>
            <Link href="/results" className="rounded-lg border border-line px-5 py-2.5 text-sm font-medium hover:border-accent/50">
              See the backtest
            </Link>
          </div>
        </div>
        <CityPreview />
      </section>

      <SectionTitle title="How it works" />
      <div className="grid gap-3 md:grid-cols-3">
        {STEPS.map((s) => (
          <div key={s.n} className="rounded-2xl border border-line bg-panel p-5">
            <div className="num flex h-7 w-7 items-center justify-center rounded-full bg-accent/15 text-sm font-semibold text-accent">{s.n}</div>
            <h3 className="mt-3 font-medium">{s.title}</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-muted">{s.body}</p>
          </div>
        ))}
      </div>

      <SectionTitle title="Does it work?">
        Each settled day is rebuilt using only the reports available at the time, then scored against the contract Gemini paid
        out on.
      </SectionTitle>
      <EvidenceStrip />

      <SectionTitle title="Explore" />
      <div className="grid gap-3 sm:grid-cols-2">
        {AREAS.map((a) => (
          <Link key={a.href} href={a.href} className="group rounded-2xl border border-line bg-panel p-5 transition hover:border-accent/50 hover:bg-panel-2">
            <div className="flex items-center justify-between">
              <h3 className="font-medium">{a.title}</h3>
              <span className="text-muted transition group-hover:translate-x-0.5 group-hover:text-accent">→</span>
            </div>
            <p className="mt-1.5 text-sm leading-relaxed text-muted">{a.body}</p>
          </Link>
        ))}
      </div>
    </>
  );
}
