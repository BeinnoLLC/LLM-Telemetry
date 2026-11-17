/** Port of src/llm_telemetry/energy.py — T-15 (LLMTELEMET-286).
 *
 * The single home of the power model: local models burn electricity at the
 * user's tariff. Operation order matches the Python source exactly so the
 * parity diff sees identical doubles.
 */

import { get as getConfig } from "./config.js";

export const LOCAL_TPS: ReadonlyArray<[string, number]> = [
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

interface TariffConfig {
  electricity_rate_kwh: number;
  gpu_draw_watts: number;
  host_overhead_watts: number;
}

/** `(usd_per_kwh, gpu_watts, host_watts)` exactly as configured. */
export function tariff(cfg?: TariffConfig): [number, number, number] {
  const c = cfg ?? getConfig();
  return [
    Number(c.electricity_rate_kwh),
    Number(c.gpu_draw_watts),
    Number(c.host_overhead_watts),
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

/** `-> ((input, output, cache) USD per 1M tokens, tokens/s)`. */
export function localRates(
  model: string | null,
  cfg?: TariffConfig,
): [[number, number, number], number] {
  const [kwh, gpuW, hostW] = tariff(cfg);
  const tps = tpsFor(model);
  const usd_per_sec = ((gpuW + hostW) / 1000.0) * kwh / 3600.0;
  const out_1m = usd_per_sec * (1e6 / tps);
  return [[out_1m / PREFILL_SPEEDUP, out_1m, out_1m / CACHE_SPEEDUP], tps];
}

/** Electricity cost of one usage row's tokens, USD. */
export function energyUsd(
  model: string | null,
  inp: number,
  outp: number,
  cache: number,
  cfg?: TariffConfig,
): number {
  const [[ri, ro, rc]] = localRates(model, cfg);
  return (inp * ri + outp * ro + cache * rc) / 1e6;
}
