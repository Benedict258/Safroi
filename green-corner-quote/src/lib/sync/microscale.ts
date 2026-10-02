import { parsePrice, userAgent, type Fetcher, type Observation, type SupplierSearchHit } from "./types";

export const MICROSCALE_ORIGIN = "https://www.microscale.net";

interface ShopifyVariant {
  sku?: string | null;
  title?: string;
  price?: string | number;
  available?: boolean;
}
interface ShopifyProduct {
  handle?: string;
  title?: string;
  variants?: ShopifyVariant[];
}

/** Ref format: "<handle>#<sku>", or just "<handle>" for the first variant. */
export function makeMicroscaleRef(handle: string, sku?: string | null): string {
  return sku ? `${handle}#${sku}` : handle;
}

export function splitMicroscaleRef(ref: string): { handle: string; sku: string | null } {
  const i = ref.indexOf("#");
  return i === -1 ? { handle: ref, sku: null } : { handle: ref.slice(0, i), sku: ref.slice(i + 1) || null };
}

/** One observation per variant. Variant-less SKUs fall back to the handle-only ref for the first variant. */
export function parseProductsJson(json: unknown): Observation[] {
  const products = (json as { products?: ShopifyProduct[] })?.products;
  if (!Array.isArray(products)) throw new Error("Microscale feed: missing products array");
  const out: Observation[] = [];
  for (const p of products) {
    if (!p.handle || !Array.isArray(p.variants)) continue;
    p.variants.forEach((v, i) => {
      const multi = (p.variants as ShopifyVariant[]).length > 1;
      const title = multi && v.title && v.title !== "Default Title" ? `${p.title} (${v.title})` : String(p.title ?? p.handle);
      const inStock = typeof v.available === "boolean" ? v.available : null;
      const price = parsePrice(v.price);
      if (v.sku) out.push({ ref: makeMicroscaleRef(p.handle as string, v.sku), title, price, inStock });
      if (i === 0) out.push({ ref: makeMicroscaleRef(p.handle as string), title, price, inStock });
    });
  }
  return out;
}

/** Pages through /products.json until a page comes back empty. */
export async function fetchMicroscaleFeed(
  fetchFn: Fetcher = fetch,
  opts: { maxPages?: number; onPage?: (page: number, count: number) => void } = {},
): Promise<Observation[]> {
  const max = opts.maxPages ?? 100;
  const all: Observation[] = [];
  for (let page = 1; page <= max; page++) {
    const res = await fetchFn(`${MICROSCALE_ORIGIN}/products.json?limit=250&page=${page}`, {
      headers: { "user-agent": userAgent(), accept: "application/json" },
    });
    if (!res.ok) throw new Error(`Microscale feed page ${page}: HTTP ${res.status}`);
    const json = await res.json();
    const products = (json as { products?: unknown[] }).products;
    if (!Array.isArray(products)) throw new Error(`Microscale feed page ${page}: missing products array`);
    if (products.length === 0) return all;
    const obs = parseProductsJson(json);
    all.push(...obs);
    opts.onPage?.(page, products.length);
  }
  throw new Error(`Microscale feed: still returning products after ${max} pages`);
}

/** Pull the handle out of a pasted Microscale product URL. */
export function microscaleHandleFromUrl(input: string): string | null {
  try {
    const u = new URL(input.trim());
    if (!/(^|\.)microscale\.net$/i.test(u.hostname)) return null;
    const m = /\/products\/([^/?#]+)/.exec(u.pathname);
    return m ? decodeURIComponent(m[1]) : null;
  } catch {
    return null;
  }
}

let feedCache: { at: number; obs: Observation[] } | null = null;

/** In-app search reads the public feed (cached 10 min) so it never needs a separate endpoint. */
export async function searchMicroscale(q: string, fetchFn: Fetcher = fetch): Promise<SupplierSearchHit[]> {
  const handle = microscaleHandleFromUrl(q);
  if (/^https?:\/\//i.test(q.trim()) && !handle) throw new Error("That is not a Microscale product URL (it should look like https://www.microscale.net/products/name)");
  if (!feedCache || Date.now() - feedCache.at > 600_000) {
    feedCache = { at: Date.now(), obs: await fetchMicroscaleFeed(fetchFn) };
  }
  const needle = q.trim().toLowerCase();
  const hits = feedCache.obs.filter((o) => {
    if (!o.ref.includes("#")) return false; // list each SKU once; handle-only refs duplicate the first variant
    if (handle) return o.ref.startsWith(`${handle}#`);
    return o.title.toLowerCase().includes(needle) || o.ref.toLowerCase().includes(needle);
  });
  return hits.slice(0, 25).map((o) => ({
    supplier: "microscale" as const,
    ref: o.ref,
    title: o.title,
    price: o.price,
    inStock: o.inStock,
    url: `${MICROSCALE_ORIGIN}/products/${o.ref.split("#")[0]}`,
  }));
}
