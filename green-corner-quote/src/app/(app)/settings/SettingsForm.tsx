"use client";
import { useActionState } from "react";
import { saveSettings } from "./actions";
import type { AppSettings } from "@/lib/settings";

export default function SettingsForm({ s }: { s: AppSettings }) {
  const [state, action, pending] = useActionState(saveSettings, undefined);
  return (
    <form action={action} className="stack card">
      <label>Sync times (Lagos time, comma separated)<input name="sync_times" defaultValue={s.syncTimes.join(", ")} required /></label>
      <label>Hold price changes bigger than (%)<input name="price_jump_threshold_pct" type="number" step="any" min="1" defaultValue={s.priceJumpThresholdPct} required /></label>
      <label>Show a stale badge after (hours without a refresh)<input name="stale_after_hours" type="number" min="1" defaultValue={s.staleAfterHours} required /></label>
      {state?.error && <p className="error" role="alert">{state.error}</p>}
      {state?.message && <p className="notice" role="status">{state.message}</p>}
      <div><button className="btn primary" disabled={pending}>{pending ? "Saving..." : "Save settings"}</button></div>
    </form>
  );
}
