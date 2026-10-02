import type { Supplier } from "../pricing";

/** What a supplier page or feed says about one listing right now. */
export interface Observation {
  ref: string;
  title: string;
  price: number | null; // null when missing or not numeric
  inStock: boolean | null; // null when the page does not say
}

export type Fetcher = typeof fetch;
export type Sleep = (ms: number) => Promise<void>;

export interface SupplierSearchHit {
  supplier: Supplier;
  ref: string;
  title: string;
  price: number | null;
  inStock: boolean | null;
  url: string;
}

export function userAgent(): string {
  const contact = process.env.SYNC_CONTACT || "https://waste2light.com";
  return `Waste2Light-QuoteTool/1.0 (internal price check; contact ${contact})`;
}

export function parsePrice(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") return Number.isFinite(raw) && raw > 0 ? raw : null;
  const cleaned = String(raw).replace(/[^0-9.]/g, "");
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) && n > 0 ? n : null;
}
