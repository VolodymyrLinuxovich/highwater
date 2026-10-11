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

### On real Gemini contracts

`scripts/realcontracts.ts` replays 978 settled Gemini weather events in 49 cities (2026-09-21 to 2026-10-10). Each day
is rebuilt as of a local hour using only the METARs available then, and scored against the contract Gemini actually
settled YES. Lower Brier is better.

| As of | Highwater | Floor only | Forecast only | Avg P(winning contract), Highwater vs forecast |
| ----- | --------- | ---------- | ------------- | ---------------------------------------------- |
| 12:00 | 0.427     | 0.450      | 0.477         | 56% vs 50%                                     |
| 15:00 | 0.338     | 0.390      | 0.477         | 65% vs 50%                                     |
| 18:00 | 0.306     | 0.377      | 0.477         | 70% vs 50%                                     |

"Floor only" just cuts the forecast distribution at the high so far. It explains about half of the gain.

- **Impossible means impossible.** Of 2,345 contracts the floor ruled out, all 2,345 settled NO. Rounding the METAR
  max instead of truncating it produced one wrong call (Anchorage, 10/05), so the engine truncates.
- **The station map is right.** For all 49 cities, the official CLI high at our mapped station falls in the contract
  Gemini settled YES on every day checked. Nearby stations don't: LaGuardia matches NYC 15% of the time, O'Hare
  matches Chicago 50%.

### Synthetic bins, longer window

`scripts/backtest.ts` covers 2026-09-10 to 2026-10-10 at 12 stations (371 station-days) with synthetic 2°F bins. It also
produces the calibration curve and the parameters the live engine uses. At 9:00 the observed max says little and the
nowcast scores worse than the forecast (Brier 0.547 vs 0.489). So the live engine blends from forecast-only at 9:00
to the full nowcast at 12:00.

Caveats: the historical forecasts are stitched short-lead runs, which flatters the baseline. The forecast-only spread
and the unobserved-peak distribution were fitted on the same days.

## Sandbox desk

Gemini's sandbox lists crypto and commodity contracts but no weather markets. So the desk applies the same question,
where will it land at expiry, to the sandbox's crypto price contracts. It uses Gemini spot and 2-hour realized
volatility in a lognormal model, then takes the gaps with signed REST orders on the sandbox.

## Run it

```bash
npm install
npm run dev            # http://localhost:3000
npx tsx scripts/backtest.ts       # synthetic-bin backtest -> public/backtest.json (~35s)
npx tsx scripts/realcontracts.ts  # settled Gemini contracts -> public/realcontracts.json (~45s)
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
| `scripts/lib-replay.ts`       | Shared replay: data loading, nowcast and baseline models, scoring  |
| `scripts/backtest.ts`         | Synthetic-bin backtest, calibration, parameter estimates           |
| `scripts/realcontracts.ts`    | Scoring on settled Gemini contracts, station-map check             |

## Data sources

Gemini Prediction Markets API (public market data, sandbox trading), aviationweather.gov METARs, Open-Meteo ensemble
and historical forecast APIs, api.weather.gov station metadata, and the Iowa Environmental Mesonet ASOS and CLI
archives.

## Limits

- The city-to-station map follows the airport code, with explicit exceptions (Central Park for NYC, Midway for Chicago).
  It is verified against 20 days of Gemini settlements per city.
- Gemini doesn't allow weather trading in the sandbox, so weather quotes are shown, not posted.
- Not financial advice.
