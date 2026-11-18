/** Electricity cost of local inference — T-6 (LLMTELEMET-285).
 *
 * Port of `energy.py` (P7-01/02): the single home of the power model. Local
 * models are not free: they burn electricity at the user's tariff. Values are
 * derived so no private copy of a tariff exists anywhere.
 *
 * Tariff and wattage come from config (electricity_rate_kwh, gpu_draw_watts,
 * host_overhead_watts); defaults are 0.047 USD/kWh, 350 W GPU, 90 W host.
 */
import type { Config } from "./config.js";

export const LOCAL_TPS: ReadonlyArray<readonly [string, number]> = [
  ["70b", 11], ["72b", 11], ["34b", 26], ["32b", 28], ["30b", 30],
  ["27b", 33], ["14b", 55], ["13b", 58], ["9b", 66], ["8b", 95], ["7b", 100],
  ["4b", 150], ["3b", 170], ["1.5b", 240], ["1b", 300],
];
export const LOCAL_TPS_DEFAULT = 40;

export const TPS_NAME_PINS: Record<string, string> = {
  "ornith:latest": "9b",
  "clef:latest": "27b",
};

export const PREFILL_SPEEDUP = 12;
export const CACHE_SPEEDUP = 60;

export function tariff(cfg: Config): [number, number, number] {
  return [
    Number(cfg.electricity_rate_kwh),
    Number(cfg.gpu_draw_watts),
    Number(cfg.host_overhead_watts),
  ];
}

export function tpsFor(model: string | null): number {
  let m = (model ?? "").toLowerCase();
  const pinned = TPS_NAME_PINS[m];
  if (pinned !== undefined) m = pinned;
  for (const [band, rate] of LOCAL_TPS) {
    if (m.includes(band)) return rate;
  }
  return LOCAL_TPS_DEFAULT;
}

/** -> [[input, output, cache] USD per 1M tokens, tokens/s]. */
export function localRates(model: string | null, cfg: Config): {
  rates: [number, number, number];
  tps: number;
} {
  const [kwh, gpuW, hostW] = tariff(cfg);
  const tps = tpsFor(model);
  const usdPerSec = ((gpuW + hostW) / 1000.0) * kwh / 3600.0;
  const out1m = usdPerSec * (1e6 / tps);
  return { rates: [out1m / PREFILL_SPEEDUP, out1m, out1m / CACHE_SPEEDUP], tps };
}
