import { query } from "./db";

export interface AppSettings {
  syncTimes: string[];
  priceJumpThresholdPct: number;
  staleAfterHours: number;
}

export const SETTING_DEFAULTS: AppSettings = {
  syncTimes: ["06:00", "18:00"],
  priceJumpThresholdPct: 30,
  staleAfterHours: 48,
};

export function parseSettings(rows: { key: string; value: string }[]): AppSettings {
  const m = new Map(rows.map((r) => [r.key, r.value]));
  const num = (k: string, d: number) => {
    const n = Number(m.get(k));
    return Number.isFinite(n) && n > 0 ? n : d;
  };
  const times = (m.get("sync_times") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => /^\d{1,2}:\d{2}$/.test(s));
  return {
    syncTimes: times.length ? times : SETTING_DEFAULTS.syncTimes,
    priceJumpThresholdPct: num("price_jump_threshold_pct", SETTING_DEFAULTS.priceJumpThresholdPct),
    staleAfterHours: num("stale_after_hours", SETTING_DEFAULTS.staleAfterHours),
  };
}

export async function getSettings(): Promise<AppSettings> {
  return parseSettings(await query("select key, value from settings"));
}
