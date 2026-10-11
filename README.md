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
  max instead of truncating it produced one wrong call (Anchorage, 10/04), so the engine truncates.
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

## Agent API: pay per forecast in AUSD (x402)

Trading bots don't want a subscription. They want one number right before they quote. Highwater sells each forecast
per call over [x402](https://x402.org), paid in Agora's AUSD on Base Sepolia.

| Endpoint                          | Price      | Returns                                                     |
| --------------------------------- | ---------- | ----------------------------------------------------------- |
| `GET /api/paid/forecast?city=NYC` | 0.005 AUSD | distribution of the final high, fair value per contract, book |
| `GET /api/paid/board`             | 0.05 AUSD  | the same for all 49 cities                                  |

1. **The ask.** An unpaid request gets `402 Payment Required` with standard x402 v1 requirements: scheme `exact`,
   network `base-sepolia`, asset AUSD (`0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC`), and EIP-712 domain
   `Agora Dollar` / `1`.
2. **The payment.** The agent signs an ERC-3009 `TransferWithAuthorization`. It needs no ETH, only AUSD.
3. **The check.** Highwater verifies the signature, recipient, amount, validity window, unused nonce and balance.
4. **Settlement.** Highwater submits `transferWithAuthorization` from its relayer wallet, waits for the receipt, then
   returns the data with an `X-PAYMENT-RESPONSE` header carrying the transaction hash.

Any stock x402 client works. `scripts/agent.ts` uses `x402-fetch` unchanged:

```bash
npx tsx --env-file=.env.local scripts/fund-agent.ts                 # faucet AUSD to the agent (relayer pays gas)
npx tsx --env-file=.env.local scripts/agent.ts http://localhost:3000 NYC CHI MIA
```

The dashboard's revenue panel reads AUSD transfers into the treasury from Base Sepolia's Blockscout, so every payment
it shows is on-chain.

Settings (`.env.local`, test wallets only): `X402_PAY_TO` (treasury), `X402_RELAYER_KEY` (pays gas for settlement),
`AGENT_KEY` (the demo buyer).

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
| `src/lib/x402.ts`             | x402 paywall: requirements, ERC-3009 verify, on-chain settlement   |
| `scripts/agent.ts`            | Trading agent that buys forecasts over x402                        |
| `scripts/lib-replay.ts`       | Shared replay: data loading, nowcast and baseline models, scoring  |
| `scripts/backtest.ts`         | Synthetic-bin backtest, calibration, parameter estimates           |
| `scripts/realcontracts.ts`    | Scoring on settled Gemini contracts, station-map check             |

## Data sources

Gemini Prediction Markets API (public market data, sandbox trading), Agora AUSD on Base Sepolia, aviationweather.gov METARs, Open-Meteo ensemble
and historical forecast APIs, api.weather.gov station metadata, and the Iowa Environmental Mesonet ASOS and CLI
archives.

## Limits

- The city-to-station map follows the airport code, with explicit exceptions (Central Park for NYC, Midway for Chicago).
  It is verified against 20 days of Gemini settlements per city.
- Gemini doesn't allow weather trading in the sandbox, so weather quotes are shown, not posted.
- Not financial advice.
