"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { query, tx } from "@/lib/db";

export async function createBundle(form: FormData) {
  await requireAdmin();
  const name = String(form.get("name") ?? "").trim();
  if (!name) redirect("/bundles/new?error=name");
  const [b] = await query("insert into bundles (name, description) values ($1, $2) returning id", [name.slice(0, 200), String(form.get("description") ?? "").slice(0, 1000)]);
  redirect(`/bundles/${b.id}`);
}

export async function updateBundle(id: number, form: FormData) {
  await requireAdmin();
  const name = String(form.get("name") ?? "").trim();
  if (!name) return;
  await query("update bundles set name = $2, description = $3 where id = $1", [id, name.slice(0, 200), String(form.get("description") ?? "").slice(0, 1000)]);
  revalidatePath(`/bundles/${id}`);
  revalidatePath("/bundles");
}

export async function setBundleActive(id: number, active: boolean) {
  await requireAdmin();
  await query("update bundles set active = $2 where id = $1", [id, active]);
  revalidatePath("/bundles");
  revalidatePath(`/bundles/${id}`);
}

export async function deleteBundle(id: number) {
  await requireAdmin();
  await query("delete from bundles where id = $1", [id]);
  redirect("/bundles");
}

/** Replaces the bundle's contents. Returns errors instead of throwing so the browser can show them. */
export async function saveBundleItems(id: number, items: { componentId: number; quantity: number }[]): Promise<{ ok: true } | { error: string }> {
  await requireAdmin();
  const merged = new Map<number, number>();
  for (const i of items) {
    const q = Math.floor(Number(i.quantity));
    if (!Number.isInteger(i.componentId) || !Number.isFinite(q) || q < 1 || q > 100000) return { error: "Quantities must be whole numbers of at least 1." };
    merged.set(i.componentId, (merged.get(i.componentId) ?? 0) + q);
  }
  try {
    await tx(async (c) => {
      await c.query("delete from bundle_items where bundle_id = $1", [id]);
      for (const [componentId, quantity] of merged) {
        await c.query("insert into bundle_items (bundle_id, component_id, quantity) values ($1, $2, $3)", [id, componentId, quantity]);
      }
    });
  } catch {
    return { error: "Could not save. A component may have been deleted." };
  }
  revalidatePath(`/bundles/${id}`);
  revalidatePath("/bundles");
  return { ok: true };
}
