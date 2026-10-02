"use server";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { query } from "@/lib/db";

export async function saveSettings(_: { message?: string; error?: string } | undefined, form: FormData): Promise<{ message?: string; error?: string }> {
  await requireAdmin();
  const times = String(form.get("sync_times") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (times.length === 0 || times.length > 6 || !times.every((t) => /^([01]?\d|2[0-3]):[0-5]\d$/.test(t))) {
    return { error: "Sync times must look like 06:00, 18:00 (24-hour, Lagos time, up to 6 times)." };
  }
  const jump = Number(form.get("price_jump_threshold_pct"));
  const stale = Number(form.get("stale_after_hours"));
  if (!Number.isFinite(jump) || jump <= 0 || jump > 1000) return { error: "Price-jump threshold must be a percentage above 0." };
  if (!Number.isFinite(stale) || stale < 1 || stale > 24 * 30) return { error: "Stale-after must be between 1 and 720 hours." };
  const rows: [string, string][] = [
    ["sync_times", times.map((t) => t.padStart(5, "0")).join(",")],
    ["price_jump_threshold_pct", String(jump)],
    ["stale_after_hours", String(stale)],
  ];
  for (const [k, v] of rows) {
    await query("insert into settings (key, value) values ($1, $2) on conflict (key) do update set value = excluded.value", [k, v]);
  }
  revalidatePath("/settings");
  return { message: "Settings saved." };
}
