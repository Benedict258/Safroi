import { query } from "./db";
import type { ListingPrice, ListingStatus, Supplier } from "./pricing";

export interface ListingRecord extends ListingPrice {
  id: number;
  componentId: number;
  supplierRef: string;
  title: string | null;
  lastChangedAt: string | null;
  lastError: string | null;
}

export interface ComponentRecord {
  id: number;
  name: string;
  category: string;
  description: string;
  unitLabel: string;
  markupPct: number;
  active: boolean;
  listings: ListingRecord[];
}

export interface BundleRecord {
  id: number;
  name: string;
  description: string;
  active: boolean;
  items: { id: number; componentId: number; quantity: number }[];
}

const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);

function toListing(r: any): ListingRecord {
  return {
    id: r.id,
    componentId: r.component_id,
    supplier: r.supplier as Supplier,
    supplierRef: r.supplier_ref,
    title: r.title,
    unitsPerListing: r.units_per_listing,
    price: r.price_ngn,
    inStock: r.in_stock,
    status: r.status as ListingStatus,
    lastSyncedAt: iso(r.last_synced_at),
    lastChangedAt: iso(r.last_changed_at),
    lastError: r.last_error,
  };
}

export interface ComponentFilter {
  q?: string;
  category?: string;
  activeOnly?: boolean;
  ids?: number[];
}

export async function loadComponents(f: ComponentFilter = {}): Promise<ComponentRecord[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (f.activeOnly) where.push("c.active");
  if (f.q?.trim()) {
    params.push(`%${f.q.trim().replace(/[%_\\]/g, "\\$&")}%`);
    where.push(`(c.name ilike $${params.length} or c.description ilike $${params.length})`);
  }
  if (f.category) {
    params.push(f.category);
    where.push(`c.category = $${params.length}`);
  }
  if (f.ids) {
    params.push(f.ids);
    where.push(`c.id = any($${params.length}::int[])`);
  }
  const comps = await query(`select c.* from components c ${where.length ? "where " + where.join(" and ") : ""} order by lower(c.category), lower(c.name)`, params);
  if (comps.length === 0) return [];
  const listings = await query("select * from supplier_listings where component_id = any($1::int[])", [comps.map((c) => c.id)]);
  const byComp = new Map<number, ListingRecord[]>();
  for (const l of listings) {
    const rec = toListing(l);
    byComp.set(rec.componentId, [...(byComp.get(rec.componentId) ?? []), rec]);
  }
  return comps.map((c) => ({
    id: c.id,
    name: c.name,
    category: c.category,
    description: c.description,
    unitLabel: c.unit_label,
    markupPct: c.markup_pct,
    active: c.active,
    listings: byComp.get(c.id) ?? [],
  }));
}

export async function loadComponent(id: number): Promise<ComponentRecord | null> {
  return (await loadComponents({ ids: [id] }))[0] ?? null;
}

export async function loadCategories(): Promise<string[]> {
  return (await query("select distinct category from components order by category")).map((r) => r.category);
}

export async function loadBundles(opts: { ids?: number[]; activeOnly?: boolean } = {}): Promise<BundleRecord[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (opts.activeOnly) where.push("active");
  if (opts.ids) {
    params.push(opts.ids);
    where.push("id = any($1::int[])");
  }
  const rows = await query(`select * from bundles ${where.length ? "where " + where.join(" and ") : ""} order by lower(name)`, params);
  if (rows.length === 0) return [];
  const items = await query("select * from bundle_items where bundle_id = any($1::int[]) order by id", [rows.map((b) => b.id)]);
  return rows.map((b) => ({
    id: b.id,
    name: b.name,
    description: b.description,
    active: b.active,
    items: items.filter((i) => i.bundle_id === b.id).map((i) => ({ id: i.id, componentId: i.component_id, quantity: i.quantity })),
  }));
}
