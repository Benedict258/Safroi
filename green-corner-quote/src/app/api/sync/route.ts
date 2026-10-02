import { NextResponse } from "next/server";
import { after } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createRun, runSync } from "@/lib/sync/run";
import { query } from "@/lib/db";

export const maxDuration = 300;

/** "Sync now": starts a run in the background and returns at once; the Sync page shows progress. */
export async function POST(req: Request) {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const supplier = body.supplier;
  if (supplier !== "microscale" && supplier !== "hub360") return NextResponse.json({ error: "Unknown supplier" }, { status: 400 });
  const componentId = Number.isInteger(body.componentId) ? (body.componentId as number) : undefined;
  const [running] = await query("select id from sync_runs where supplier = $1 and status = 'running' and started_at > now() - interval '30 minutes' limit 1", [supplier]);
  if (running) return NextResponse.json({ error: "A sync for this supplier is already running.", runId: running.id }, { status: 409 });
  const runId = await createRun(supplier, "manual", componentId);
  after(() => runSync({ supplier, trigger: "manual", componentId, runId }).then(() => undefined));
  return NextResponse.json({ runId });
}
