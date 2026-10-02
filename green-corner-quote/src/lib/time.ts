export const TZ = "Africa/Lagos";

export function formatLagos(d: string | Date | null | undefined): string {
  if (!d) return "never";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(d));
}

/** Parts of a date as seen on the wall clock in Lagos. */
export function lagosParts(d: Date): { y: number; m: number; day: number; hh: number; mm: number } {
  const p = new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (t: string) => Number(p.find((x) => x.type === t)?.value);
  const hh = get("hour") % 24;
  return { y: get("year"), m: get("month"), day: get("day"), hh, mm: get("minute") };
}

/** Lagos is UTC+1 all year (no DST). */
export function lagosToUtc(y: number, m: number, day: number, hh: number, mm: number): Date {
  return new Date(Date.UTC(y, m - 1, day, hh - 1, mm));
}

/** The most recent configured sync slot at or before `now`, or null if no times are configured. */
export function latestDueSlot(times: string[], now: Date): Date | null {
  const { y, m, day } = lagosParts(now);
  const slots: Date[] = [];
  for (const t of times) {
    const match = /^(\d{1,2}):(\d{2})$/.exec(t.trim());
    if (!match) continue;
    const hh = Number(match[1]);
    const mm = Number(match[2]);
    if (hh > 23 || mm > 59) continue;
    slots.push(lagosToUtc(y, m, day, hh, mm));
    slots.push(lagosToUtc(y, m, day - 1, hh, mm));
  }
  const due = slots.filter((s) => s.getTime() <= now.getTime()).sort((a, b) => b.getTime() - a.getTime());
  return due[0] ?? null;
}
