// Model parameters. The defaults are conservative priors; scripts/backtest.ts
// estimates them from the last month of CLI reports and they get copied here.
export const PARAMS = {
  // Extra °F the official max can exceed the highest METAR reading by
  // (ASOS peaks between reports). Discrete distribution over 0, 1, 2, ...
  peakUplift: [0.388, 0.518, 0.084, 0.008, 0.003],
  // Forecast error sd (°F) grows with hours ahead: base + slope * h, capped.
  noiseBase: 0.5,
  noiseSlope: 0.1,
  noiseCap: 4.0,
  // How strongly today's observed forecast bias carries into the remaining hours.
  biasHalfLifeHours: 6,
  // Before ~noon local standard time the observed max says little, and the
  // backtest scores the forecast-only model better at 9am. Blend from
  // forecast-only (at blendStartHour) to full nowcast (at blendEndHour).
  blendStartHour: 9,
  blendEndHour: 12,
  source: "backtest 2026-09-10 to 2026-10-10, 12 stations, 371 days",
};
