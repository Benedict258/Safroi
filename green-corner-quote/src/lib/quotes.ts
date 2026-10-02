import { query, tx } from "./db";
import { loadBundles, loadComponents } from "./catalog";
import { priceBundle, priceComponent, type Supplier, type Warning } from "./pricing";
import { getSettings } from "./settings";

export interface LineInput {
  lineId?: number | null;
  kind: "component" | "bundle";
  refId: number;
  quantity: number;
  override?: Supplier | null;
  /** Drop the saved snapshot and price this line at today's prices. */
  reprice?: boolean;
}

export interface QuoteLineRecord {
  id: number;
  position: number;
  componentId: number | null;
  bundleId: number | null;
  name: string;
  quantity: number;
  supplierUsed: Supplier | null;
  supplierPrice: number | null;
  markupPct: number | null;
  unitPrice: number;
  lineTotal: number;
  detail: unknown;
  warnings: Warning[];
}

export interface QuoteRecord {
  id: number;
  name: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
  total: number;
  lines: QuoteLineRecord[];
}

function toLine(r: any): QuoteLineRecord {
  return {
    id: r.id,
    position: r.position,
    componentId: r.component_id,
    bundleId: r.bundle_id,
    name: r.name,
    quantity: r.quantity,
    supplierUsed: r.supplier_used,
    supplierPrice: r.supplier_price_ngn,
    markupPct: r.markup_pct,
    unitPrice: r.unit_price_ngn,
    lineTotal: r.line_total_ngn,
    detail: r.detail,
    warnings: r.warnings ?? [],
  };
}

export async function loadQuote(id: number): Promise<QuoteRecord | null> {
  const [q] = await query("select * from quotes where id = $1", [id]);
  if (!q) return null;
  const lines = await query("select * from quote_lines where quote_id = $1 order by position, id", [id]);
  return {
    id: q.id,
    name: q.name,
    notes: q.notes,
    createdAt: new Date(q.created_at).toISOString(),
    updatedAt: new Date(q.updated_at).toISOString(),
    total: q.total_ngn,
    lines: lines.map(toLine),
  };
}

export async function listQuotes() {
  return (await query("select q.id, q.name, q.total_ngn, q.updated_at, (select count(*)::int from quote_lines l where l.quote_id = q.id) as lines from quotes q order by q.updated_at desc")).map(
    (r) => ({ id: r.id as number, name: r.name as string, total: r.total_ngn as number, updatedAt: new Date(r.updated_at).toISOString(), lines: r.lines as number }),
  );
}

type Snapshot = Omit<QuoteLineRecord, "id" | "position">;

/**
 * Saves a quote. Each line is re-priced from the database here (the client is never trusted for prices),
 * except lines that already exist on this quote and are unchanged: those keep their saved snapshot so
 * later supplier syncs never change a saved quote. Only the quantity (and so the line total) can move.
 */
export async function saveQuote(id: number | null, name: string, notes: string, inputs: LineInput[]): Promise<number> {
  const cleanName = name.trim();
  if (!cleanName) throw new Error("Give the quote a name.");
  if (inputs.length > 200) throw new Error("A quote can have at most 200 lines.");
  const settings = await getSettings();
  const now = new Date();
  const opts = { now, staleAfterHours: settings.staleAfterHours };

  const existing = id ? (await loadQuote(id))?.lines ?? [] : [];
  if (id && !(await query("select 1 from quotes where id = $1", [id]))[0]) throw new Error("Quote not found.");

  const compIds = inputs.filter((l) => l.kind === "component").map((l) => l.refId);
  const bundleIds = inputs.filter((l) => l.kind === "bundle").map((l) => l.refId);
  const bundles = await loadBundles({ ids: bundleIds });
  const neededComps = new Set([...compIds, ...bundles.flatMap((b) => b.items.map((i) => i.componentId))]);
  const comps = new Map((await loadComponents({ ids: [...neededComps] })).map((c) => [c.id, c]));
  const bundleMap = new Map(bundles.map((b) => [b.id, b]));

  const snapshots: Snapshot[] = inputs.map((inp) => {
    const qty = Math.floor(Number(inp.quantity));
    if (!Number.isFinite(qty) || qty < 1 || qty > 100000) throw new Error("Quantities must be whole numbers from 1 to 100,000.");
    const prev = inp.lineId ? existing.find((e) => e.id === inp.lineId) : undefined;
    const sameRef = prev && (inp.kind === "component" ? prev.componentId === inp.refId : prev.bundleId === inp.refId);
    const overrideUnchanged = !inp.override || inp.override === prev?.supplierUsed;
    if (prev && sameRef && overrideUnchanged && !inp.reprice) {
      return { ...prev, quantity: qty, lineTotal: prev.unitPrice * qty };
    }
    if (inp.kind === "component") {
      const c = comps.get(inp.refId);
      if (!c) throw new Error("A component on this quote no longer exists.");
      const p = priceComponent(c.listings, c.markupPct, qty, { ...opts, override: inp.override });
      return {
        componentId: c.id, bundleId: null, name: c.name, quantity: qty, supplierUsed: p.supplierUsed, supplierPrice: p.supplierPrice,
        markupPct: c.markupPct, unitPrice: p.unitPrice, lineTotal: p.lineTotal, detail: null, warnings: p.warnings,
      };
    }
    const b = bundleMap.get(inp.refId);
    if (!b) throw new Error("A bundle on this quote no longer exists.");
    const items = b.items.map((i) => {
      const c = comps.get(i.componentId)!;
      return { componentId: c.id, name: c.name, markupPct: c.markupPct, listings: c.listings, quantity: i.quantity };
    });
    const p = priceBundle(items, qty, opts);
    return {
      componentId: null, bundleId: b.id, name: b.name, quantity: qty, supplierUsed: null, supplierPrice: null, markupPct: null,
      unitPrice: p.unitPrice, lineTotal: p.lineTotal, detail: p.breakdown, warnings: p.warnings,
    };
  });

  const total = snapshots.reduce((s, l) => s + l.lineTotal, 0);
  return tx(async (c) => {
    let quoteId = id;
    if (quoteId) {
      await c.query("update quotes set name = $2, notes = $3, total_ngn = $4, updated_at = now() where id = $1", [quoteId, cleanName, notes, total]);
      await c.query("delete from quote_lines where quote_id = $1", [quoteId]);
    } else {
      quoteId = (await c.query("insert into quotes (name, notes, total_ngn) values ($1, $2, $3) returning id", [cleanName, notes, total])).rows[0].id;
    }
    let pos = 0;
    for (const s of snapshots) {
      await c.query(
        `insert into quote_lines (quote_id, position, component_id, bundle_id, name, quantity, supplier_used, supplier_price_ngn, markup_pct,
           unit_price_ngn, line_total_ngn, detail, warnings) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [quoteId, pos++, s.componentId, s.bundleId, s.name, s.quantity, s.supplierUsed, s.supplierPrice, s.markupPct, s.unitPrice, s.lineTotal,
         s.detail ? JSON.stringify(s.detail) : null, JSON.stringify(s.warnings)],
      );
    }
    return quoteId as number;
  });
}

/** Copies a quote's lines into a new quote priced at today's prices. */
export async function duplicateQuote(id: number): Promise<number> {
  const q = await loadQuote(id);
  if (!q) throw new Error("Quote not found.");
  const inputs: LineInput[] = q.lines
    .filter((l) => l.componentId || l.bundleId)
    .map((l) => (l.componentId ? { kind: "component" as const, refId: l.componentId, quantity: l.quantity } : { kind: "bundle" as const, refId: l.bundleId as number, quantity: l.quantity }));
  return saveQuote(null, `Copy of ${q.name}`, q.notes, inputs);
}

export async function deleteQuote(id: number): Promise<void> {
  await query("delete from quotes where id = $1", [id]);
}
