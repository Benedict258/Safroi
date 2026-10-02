// Pure decision logic for FR-8. The sync runner applies the result to the database.

export type Decision =
  | { kind: "error"; reason: string }
  | { kind: "unchanged" }
  | { kind: "first"; price: number }
  | { kind: "update"; price: number }
  | { kind: "hold"; oldPrice: number; newPrice: number; changePct: number };

export function changePct(oldPrice: number, newPrice: number): number {
  return (Math.abs(newPrice - oldPrice) / oldPrice) * 100;
}

/** Never write a missing, zero or non-numeric price; hold jumps above the threshold. */
export function decide(current: number | null, observed: number | null, thresholdPct: number): Decision {
  if (observed === null || !Number.isFinite(observed) || observed <= 0) {
    return { kind: "error", reason: "No usable price on the supplier page. Kept the last good price." };
  }
  if (current === null) return { kind: "first", price: observed };
  if (Math.round(current * 100) === Math.round(observed * 100)) return { kind: "unchanged" };
  const pct = changePct(current, observed);
  if (pct > thresholdPct) return { kind: "hold", oldPrice: current, newPrice: observed, changePct: pct };
  return { kind: "update", price: observed };
}
