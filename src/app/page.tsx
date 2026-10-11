import Link from "next/link";
import { CityTape, Instrument, LiveLine, Proof } from "@/components/Landing";
import { Reveal, Rule } from "@/components/Reveal";

const STEPS = [
  {
    title: "Mark what already happened",
    body: "Every airport weather report since local midnight sets the high-water mark. The official high can't finish below it, so every range under it is out.",
  },
  {
    title: "Forecast what's left",
    body: "82 forecast runs (GFS and ECMWF) cover the remaining hours, corrected by how far off the forecast has been today.",
  },
  {
    title: "Price every range",
    body: "Thousands of simulated finishes become a probability and a two-sided quote for each of Gemini's contracts, refreshed every minute.",
  },
];

export default function Home() {
  return (
    <>
      <section className="relative pt-12 sm:pt-16">
        <div
          className="radar-grid pointer-events-none absolute inset-x-0 top-0 -z-10 h-[520px]"
          aria-hidden
        />
        <LiveLine />
        <h1 className="mt-4 max-w-4xl text-[42px] font-semibold leading-[1.02] tracking-[-0.03em] sm:text-[68px]">
          The day&apos;s high is{" "}
          <span className="font-serif font-normal italic text-accent">
            still being written.
          </span>
        </h1>
        <div className="mt-6 flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
          <p className="max-w-xl text-lg leading-relaxed text-muted">
            Highwater reads every weather report since midnight and 82 forecast
            runs for the hours left, then estimates the probability of each of
            Gemini&apos;s daily high temperature contracts in 49 US cities, live.
          </p>
          <div className="flex shrink-0 items-center gap-5">
            <Link
              href="/board"
              className="rounded-lg bg-accent px-5 py-2.5 text-sm font-semibold text-background hover:brightness-110"
            >
              Open live board
            </Link>
            <Link
              href="/results"
              className="text-sm text-muted hover:text-foreground"
            >
              See the backtest →
            </Link>
          </div>
        </div>

        <Reveal delay={150} className="mt-10 sm:mt-12">
          <div className="border-y border-line py-6">
            <Instrument />
          </div>
        </Reveal>
      </section>

      <div className="mt-20">
        <CityTape />
      </div>
      <section className="mt-16">
        <Reveal>
          <h2 className="max-w-2xl text-3xl font-semibold tracking-tight">
            Scored on markets that{" "}
            <span className="font-serif font-normal italic">
              already settled.
            </span>
          </h2>
        </Reveal>
        <div className="mt-8">
          <Proof />
        </div>
      </section>

      <Rule className="mt-20" />
      <section className="mt-14">
        <Reveal>
          <h2 className="text-3xl font-semibold tracking-tight">
            How it works
          </h2>
        </Reveal>
        <Rule className="mt-8" />
        <ol className="mt-8 grid gap-8 md:grid-cols-3 md:gap-10">
          {STEPS.map((s, i) => (
            <li key={s.title}>
              <Reveal delay={i * 140}>
                <div className="num font-serif text-4xl italic text-accent/80">
                  {i + 1}
                </div>
                <h3 className="mt-2 font-medium">{s.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-muted">
                  {s.body}
                </p>
              </Reveal>
            </li>
          ))}
        </ol>
        <Reveal delay={420}>
          <p className="mt-10 text-sm text-muted">
            Building a bot? Forecasts are sold per call over x402 in AUSD.{" "}
            <Link href="/developers" className="text-accent hover:underline">
              For developers →
            </Link>
          </p>
        </Reveal>
      </section>
    </>
  );
}
