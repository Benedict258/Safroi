import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { searchMicroscale } from "@/lib/sync/microscale";
import { searchHub360 } from "@/lib/sync/hub360";

export const maxDuration = 60;

export async function GET(req: Request, { params }: { params: Promise<{ supplier: string }> }) {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  const { supplier } = await params;
  const q = new URL(req.url).searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) return NextResponse.json({ hits: [] });
  try {
    const hits = supplier === "microscale" ? await searchMicroscale(q) : supplier === "hub360" ? await searchHub360(q) : null;
    if (!hits) return NextResponse.json({ error: "Unknown supplier" }, { status: 404 });
    return NextResponse.json({ hits });
  } catch (e) {
    return NextResponse.json({ error: `Search failed: ${(e as Error).message}. You can paste a product URL instead.` }, { status: 502 });
  }
}
