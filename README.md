# Highwater

**Where will today's high land?** Highwater prices every Gemini daily high temperature contract live, using what the
thermometer has already recorded today, not just the forecast.

Gemini lists daily high temperature markets for 49 US cities, about 320 contracts a day. On a typical afternoon only a
handful have a bid or an ask. Highwater quotes all of them, and flags the ones that are already impossible.

## How it works

Each contract settles on the NWS Daily Climatological Report (CLI) for one station. The climate day runs midnight to
midnight **local standard time**, even during daylight saving.

1. **The floor.** All METARs (routine and special) since the start of the climate day come from aviationweather.gov in
   one batched call, along with the synoptic 6-hour max groups. The official high cannot finish below the highest
   reading so far, so every bin under it is dead.
2. **The rest of the day.** 82 ensemble members (GFS 31 + ECMWF 51, via Open-Meteo) cover the remaining hours. Each one
   is shifted by today's observed forecast miss (recent obs minus ensemble mean, recency weighted). Error grows with
   lead time.
3. **The unobserved peak.** ASOS records its max from continuous data, so the CLI high often beats the hottest METAR by
   a degree. That gap is modeled with an empirical distribution measured from last month's reports.
4. **Price it.** Final high = max(high so far + peak gap, hottest remaining hour), simulated 4,000 times and rounded to
   whole °F. That gives a probability for each contract bin, two-sided quotes with spread scaled by uncertainty, and
   flags where the Gemini book is at least 5¢ away from fair.

Before about noon local time the observed max says little, so the engine blends from the forecast-only distribution
(9:00) to the full nowcast (12:00). The backtest below is why.

## Does it work?

`scripts/backtest.ts` replays 30 days (2026-09-10 to 2026-10-10) at 12 stations, 371 station-days in all. For each day
it uses only the METARs available at a given local hour, and scores both models on 7 Gemini-style bins against the
official CLI high from the Iowa Environmental Mesonet. Lower Brier is better.

| As of | Brier, Highwater | Brier, forecast only | Top bin correct, Highwater vs forecast only |
| ----- | ---------------- | -------------------- | ------------------------------------------- |
| 09:00 | 0.547            | 0.489                | 56% vs 63%                                  |
| 12:00 | 0.476            | 0.489                | 63% vs 63%                                  |
| 15:00 | 0.404            | 0.489                | 71% vs 63%                                  |
| 18:00 | 0.351            | 0.489                | 74% vs 63%                                  |

The probabilities are well calibrated: each decile lands within about 6 points of the observed frequency. See
`public/backtest.json`.

Caveats: the historical forecasts are stitched short-lead runs, which flatters the baseline. Some of the noise
parameters were tuned on the same month. The bins are synthetic, not real Gemini strikes.

## Sandbox desk

Gemini's sandbox lists crypto and commodity contracts but no weather markets. So the desk applies the same question,
where will it land at expiry, to the sandbox's crypto price contracts. It uses Gemini spot and 2-hour realized
volatility in a lognormal model, then takes the gaps with signed REST orders on the sandbox.

## Run it

```bash
npm install
npm run dev            # http://localhost:3000
npx tsx scripts/backtest.ts   # regenerates public/backtest.json (~35s)
```

The weather side needs no keys. To trade on the sandbox, create an API key at
https://exchange.sandbox.gemini.com and add it to `.env.local`:

```
GEMINI_API_KEY=...
GEMINI_API_SECRET=...
```

## Code map

| Path                          | What                                                               |
| ----------------------------- | ------------------------------------------------------------------ |
| `src/lib/markets.ts`          | Gemini weather events and bin parsing (`LO75`, `76TO77`, `HI86`)   |
| `src/lib/stations.ts`         | City code to NWS station, climate-day window in standard time      |
| `src/lib/obs.ts`              | METAR parsing (T-group, 6-hour max), high so far                   |
| `src/lib/forecast.ts`         | Batched GFS + ECMWF ensemble fetch                                 |
| `src/lib/engine.ts`           | Bias, Monte Carlo, blend, bin probabilities, quotes                |
| `src/lib/crypto.ts`           | Sandbox crypto contracts priced from spot and realized vol         |
| `src/lib/gemini-trade.ts`     | HMAC-signed prediction market orders                               |
| `scripts/backtest.ts`         | Replay and scoring against official CLI highs                      |

## Data sources

Gemini Prediction Markets API (public market data, sandbox trading), aviationweather.gov METARs, Open-Meteo ensemble
and historical forecast APIs, api.weather.gov station metadata, and the Iowa Environmental Mesonet ASOS and CLI
archives.

## Limits

- The city-to-station map follows the airport code, with explicit exceptions (Central Park for NYC, Midway for Chicago).
  Gemini's contract text names the city, not the station.
- Gemini doesn't allow weather trading in the sandbox, so weather quotes are shown, not posted.
- Not financial advice.
