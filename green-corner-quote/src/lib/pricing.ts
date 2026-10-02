// Pure pricing rules (FR-10). No I/O so it runs on server and in the quote builder.
// Money is handled in kobo integers inside this file; callers see whole-naira numbers.

export type Supplier = "microscale" | "hub360";
export const SUPPLIERS: Supplier[] = ["microscale", "hub360"];
export const SUPPLIER_LABEL: Record<Supplier, string> = {
  microscale: "Microscale",
  hub360: "Hub360",
};

export type ListingStatus = "pending" | "ok" | "held" | "stale" | "error";

export interface ListingPrice {
  supplier: Supplier;
  price: number | null;
  inStock: boolean;
  unitsPerListing: number;
  status: ListingStatus;
  lastSyncedAt: string | Date | null;
}

export type WarningCode = "out_of_stock" | "stale" | "held" | "no_price";
export interface Warning {
  code: WarningCode;
  message: string;
}

export interface PriceOptions {
  now: Date;
  staleAfterHours: number;
  override?: Supplier | null;
}

export interface PricedComponent {
  supplierUsed: Supplier | null;
  supplierPrice: number | null; // price of one listing at the supplier used
  unitsPerListing: number;
  markupPct: number;
  unitPrice: number; // whole naira, per unit
  lineTotal: number;
  warnings: Warning[];
}

export function roundNaira(n: number): number {
  return Math.round(n);
}

/** unit price = round(supplier price / units per listing * (1 + markup/100)) */
export function unitPrice(supplierPrice: number, unitsPerListing: number, markupPct: number): number {
  if (!(unitsPerListing > 0)) throw new Error("unitsPerListing must be positive");
  const kobo = Math.round(supplierPrice * 100);
  const markupBp = Math.round(markupPct * 100); // basis points
  return Math.round((kobo * (10000 + markupBp)) / (unitsPerListing * 1_000_000));
}

export function isStale(l: Pick<ListingPrice, "lastSyncedAt" | "status">, now: Date, staleAfterHours: number): boolean {
  if (l.status === "stale") return true;
  if (!l.lastSyncedAt) return false;
  const age = now.getTime() - new Date(l.lastSyncedAt).getTime();
  return age > staleAfterHours * 3_600_000;
}

function perUnit(l: ListingPrice): number {
  return (l.price as number) / l.unitsPerListing;
}

/** Lowest in-stock per-unit price; falls back to the most recently synced listing. */
export function chooseListing(listings: ListingPrice[], override?: Supplier | null): ListingPrice | null {
  const priced = listings.filter((l) => l.price !== null && l.price > 0);
  if (priced.length === 0) return null;
  if (override) {
    const o = priced.find((l) => l.supplier === override);
    if (o) return o;
  }
  const inStock = priced.filter((l) => l.inStock);
  if (inStock.length > 0) {
    return inStock.reduce((a, b) => (perUnit(b) < perUnit(a) ? b : a));
  }
  return priced.reduce((a, b) => {
    const ta = a.lastSyncedAt ? new Date(a.lastSyncedAt).getTime() : 0;
    const tb = b.lastSyncedAt ? new Date(b.lastSyncedAt).getTime() : 0;
    if (tb !== ta) return tb > ta ? b : a;
    return perUnit(b) < perUnit(a) ? b : a;
  });
}

export function priceComponent(
  listings: ListingPrice[],
  markupPct: number,
  quantity: number,
  opts: PriceOptions,
): PricedComponent {
  const chosen = chooseListing(listings, opts.override);
  const warnings: Warning[] = [];
  if (!chosen) {
    warnings.push({ code: "no_price", message: "No supplier price yet. This line is not in the total." });
    return { supplierUsed: null, supplierPrice: null, unitsPerListing: 1, markupPct, unitPrice: 0, lineTotal: 0, warnings };
  }
  const anyInStock = listings.some((l) => l.price !== null && l.inStock);
  if (!chosen.inStock) {
    warnings.push({
      code: "out_of_stock",
      message: anyInStock
        ? `${SUPPLIER_LABEL[chosen.supplier]} is out of stock.`
        : "Out of stock at both suppliers. Priced from the most recent known price.",
    });
  }
  if (isStale(chosen, opts.now, opts.staleAfterHours)) {
    warnings.push({ code: "stale", message: `${SUPPLIER_LABEL[chosen.supplier]} price is stale.` });
  }
  if (chosen.status === "held") {
    warnings.push({ code: "held", message: `A new ${SUPPLIER_LABEL[chosen.supplier]} price is waiting for review.` });
  }
  const up = unitPrice(chosen.price as number, chosen.unitsPerListing, markupPct);
  return {
    supplierUsed: chosen.supplier,
    supplierPrice: chosen.price,
    unitsPerListing: chosen.unitsPerListing,
    markupPct,
    unitPrice: up,
    lineTotal: up * quantity,
    warnings,
  };
}

export interface BundleItemInput {
  componentId: number;
  name: string;
  markupPct: number;
  listings: ListingPrice[];
  quantity: number;
}

export interface BundleBreakdownLine {
  componentId: number;
  name: string;
  quantity: number;
  supplierUsed: Supplier | null;
  supplierPrice: number | null;
  markupPct: number;
  unitPrice: number;
  lineTotal: number;
}

export interface PricedBundle {
  unitPrice: number; // price of one bundle
  lineTotal: number;
  warnings: Warning[];
  breakdown: BundleBreakdownLine[];
}

/** Bundle price = sum of component unit prices x quantities. The bundle adds no markup. */
export function priceBundle(items: BundleItemInput[], quantity: number, opts: Omit<PriceOptions, "override">): PricedBundle {
  const breakdown: BundleBreakdownLine[] = [];
  const warnings: Warning[] = [];
  let single = 0;
  for (const it of items) {
    const p = priceComponent(it.listings, it.markupPct, it.quantity, opts);
    single += p.lineTotal;
    for (const w of p.warnings) warnings.push({ code: w.code, message: `${it.name}: ${w.message}` });
    breakdown.push({
      componentId: it.componentId,
      name: it.name,
      quantity: it.quantity,
      supplierUsed: p.supplierUsed,
      supplierPrice: p.supplierPrice,
      markupPct: it.markupPct,
      unitPrice: p.unitPrice,
      lineTotal: p.lineTotal,
    });
  }
  return { unitPrice: single, lineTotal: single * quantity, warnings, breakdown };
}

export function formatNaira(n: number): string {
  const sign = n < 0 ? "-" : "";
  return `${sign}₦${Math.abs(Math.round(n)).toLocaleString("en-NG")}`;
}
