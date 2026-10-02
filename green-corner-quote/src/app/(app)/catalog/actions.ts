"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";
import { runSync } from "@/lib/sync/run";
import { hub360RefFromUrl } from "@/lib/sync/hub360";
import type { Supplier } from "@/lib/pricing";

function fields(form: FormData) {
  const name = String(form.get("name") ?? "").trim();
  if (!name) throw new Error("Name is required.");
  const markup = Number(form.get("markup_pct"));
  if (!Number.isFinite(markup) || markup < 0 || markup > 1000) throw new Error("Markup must be between 0 and 1000.");
  return {
    name,
    category: String(form.get("category") ?? "").trim() || "General",
    description: String(form.get("description") ?? "").trim(),
    unitLabel: String(form.get("unit_label") ?? "").trim() || "pc",
    markup,
  };
}

export async function createComponent(form: FormData) {
  await requireAdmin();
  const f = fields(form);
  const row = await queryOne(
    "insert into components (name, category, description, unit_label, markup_pct) values ($1,$2,$3,$4,$5) returning id",
    [f.name, f.category, f.description, f.unitLabel, f.markup],
  );
  redirect(`/catalog/${row!.id}`);
}

export async function updateComponent(id: number, form: FormData) {
  await requireAdmin();
  const f = fields(form);
  await query("update components set name=$2, category=$3, description=$4, unit_label=$5, markup_pct=$6 where id=$1", [id, f.name, f.category, f.description, f.unitLabel, f.markup]);
  revalidatePath(`/catalog/${id}`);
  revalidatePath("/catalog");
}

export async function setComponentActive(id: number, active: boolean) {
  await requireAdmin();
  await query("update components set active = $2 where id = $1", [id, active]);
  revalidatePath("/catalog");
  revalidatePath(`/catalog/${id}`);
}

export async function deleteComponent(id: number) {
  await requireAdmin();
  const used = await queryOne("select 1 from bundle_items where component_id = $1 limit 1", [id]);
  if (used) redirect(`/catalog/${id}?error=in-bundle`);
  await query("delete from components where id = $1", [id]);
  redirect("/catalog");
}

/** Link (or re-link) a supplier listing, then fetch its first price right away. */
export async function linkListing(componentId: number, supplier: Supplier, ref: string, unitsPerListing: number, title: string | null): Promise<{ message: string }> {
  await requireAdmin();
  try {
    return await linkListingInner(componentId, supplier, ref, unitsPerListing, title);
  } catch (e) {
    return { message: (e as Error).message }; // thrown messages are hidden in production, so return it
  }
}

async function linkListingInner(componentId: number, supplier: Supplier, ref: string, unitsPerListing: number, title: string | null): Promise<{ message: string }> {
  if (supplier !== "microscale" && supplier !== "hub360") throw new Error("Unknown supplier.");
  const units = Math.floor(Number(unitsPerListing));
  if (!Number.isFinite(units) || units < 1 || units > 100000) throw new Error("Units per listing must be a whole number of at least 1.");
  let cleanRef = ref.trim();
  if (supplier === "hub360") {
    const r = hub360RefFromUrl(cleanRef);
    if (!r) throw new Error("That is not a Hub360 product URL (it should look like https://hub360.cc/shop/name-12345).");
    cleanRef = r;
  } else if (!/^[a-z0-9][a-z0-9-_.]*(#.+)?$/i.test(cleanRef)) {
    throw new Error("That is not a valid Microscale listing.");
  }
  const clash = await queryOne("select component_id from supplier_listings where supplier = $1 and supplier_ref = $2 and component_id <> $3", [supplier, cleanRef, componentId]);
  if (clash) throw new Error("That supplier product is already linked to another component.");
  // New link resets price state so the first sync is accepted without a price-jump hold.
  await query(
    `insert into supplier_listings (component_id, supplier, supplier_ref, title, units_per_listing)
     values ($1,$2,$3,$4,$5)
     on conflict (component_id, supplier) do update set supplier_ref = excluded.supplier_ref, title = excluded.title,
       units_per_listing = excluded.units_per_listing, price_ngn = null, status = 'pending', last_synced_at = null, last_error = null`,
    [componentId, supplier, cleanRef, title, units],
  );
  await query("update held_changes set decision = 'rejected', decided_at = now() where decision = 'pending' and listing_id in (select id from supplier_listings where component_id = $1 and supplier = $2)", [componentId, supplier]);
  const r = await runSync({ supplier, trigger: "manual", componentId });
  revalidatePath(`/catalog/${componentId}`);
  revalidatePath("/catalog");
  return { message: r.status === "success" ? "Linked and priced." : `Linked, but the first sync ${r.status}. Check the Sync page for the reason.` };
}

export async function updateUnits(listingId: number, units: number) {
  await requireAdmin();
  const n = Math.floor(Number(units));
  if (!Number.isFinite(n) || n < 1) throw new Error("Units per listing must be at least 1.");
  const row = await queryOne("update supplier_listings set units_per_listing = $2 where id = $1 returning component_id", [listingId, n]);
  if (row) revalidatePath(`/catalog/${row.component_id}`);
}

export async function unlinkListing(listingId: number) {
  await requireAdmin();
  const row = await queryOne("delete from supplier_listings where id = $1 returning component_id", [listingId]);
  if (row) revalidatePath(`/catalog/${row.component_id}`);
  revalidatePath("/catalog");
}
