import * as cheerio from "cheerio";
import { parsePrice, userAgent, type Fetcher, type Observation, type Sleep, type SupplierSearchHit } from "./types";

export const HUB360_ORIGIN = "https://hub360.cc";
export const HUB360_MIN_INTERVAL_MS = 1000;

/** Product URLs end in the Odoo product id, e.g. /shop/arduino-uno-r3-18006 */
export function hub360RefFromUrl(input: string): string | null {
  try {
    const u = new URL(input.trim(), HUB360_ORIGIN);
    if (!/(^|\.)hub360\.cc$/i.test(u.hostname)) return null;
    if (!/^\/shop\/(?!category\/|page\/).*-\d+\/?$/.test(u.pathname)) return null;
    return `${HUB360_ORIGIN}${u.pathname.replace(/\/$/, "")}`;
  } catch {
    return null;
  }
}

export function hub360ProductId(ref: string): string | null {
  return /-(\d+)$/.exec(ref)?.[1] ?? null;
}

const OUT_RE = /out of stock|sold out|unavailable/i;
const IN_RE = /in stock|available/i;

function stockFromAvailability(a: unknown): boolean | null {
  const s = String(a ?? "");
  if (/OutOfStock|SoldOut|Discontinued/i.test(s)) return false;
  if (/InStock|LimitedAvailability|PreOrder|BackOrder/i.test(s)) return true;
  return null;
}

function firstOffer(node: unknown): { price?: unknown; availability?: unknown } | null {
  if (!node || typeof node !== "object") return null;
  const n = node as Record<string, unknown>;
  const graph = Array.isArray(n["@graph"]) ? (n["@graph"] as unknown[]) : [n];
  for (const g of graph) {
    const item = g as Record<string, unknown>;
    const type = item["@type"];
    if (type !== "Product" && !(Array.isArray(type) && type.includes("Product"))) continue;
    let offers = item.offers as unknown;
    if (Array.isArray(offers)) offers = offers[0];
    if (offers && typeof offers === "object") return offers as { price?: unknown; availability?: unknown };
  }
  return null;
}

/**
 * Parses an Odoo product page. Tries structured data first (JSON-LD, itemprop meta),
 * then the printed price. Returns price null if nothing numeric is found.
 */
export function parseProductPage(html: string, ref: string): Observation {
  const $ = cheerio.load(html);
  const title =
    $('[itemprop="name"]').first().text().trim() ||
    $("#product_details h1").first().text().trim() ||
    $("h1").first().text().trim() ||
    $("title").text().trim() ||
    ref;

  let price: number | null = null;
  let inStock: boolean | null = null;

  $('script[type="application/ld+json"]').each((_, el) => {
    if (price !== null && inStock !== null) return;
    try {
      const offer = firstOffer(JSON.parse($(el).contents().text()));
      if (offer) {
        if (price === null) price = parsePrice(offer.price);
        if (inStock === null) inStock = stockFromAvailability(offer.availability);
      }
    } catch {
      /* ignore malformed JSON-LD */
    }
  });

  if (price === null) {
    const meta = $('[itemprop="price"]').first();
    price = parsePrice(meta.attr("content") ?? meta.text());
  }
  if (price === null) {
    const printed =
      $("#product_details .oe_price .oe_currency_value").first().text() ||
      $("#product_details .product_price .oe_currency_value").first().text() ||
      $("#product_details .oe_currency_value").first().text() ||
      $(".product_price .oe_currency_value").first().text() ||
      $(".oe_price .oe_currency_value").first().text();
    price = parsePrice(printed);
  }

  if (inStock === null) {
    const link = $('link[itemprop="availability"]').attr("href") ?? $('[itemprop="availability"]').attr("content");
    inStock = stockFromAvailability(link);
  }
  if (inStock === null) {
    const area = $("#product_details");
    const msg = area.find("#out_of_stock_message, .availability_messages, .o_wsale_product_availability").text();
    if (msg && OUT_RE.test(msg)) inStock = false;
    else if (msg && IN_RE.test(msg)) inStock = true;
    else if (area.find("#add_to_cart, .js_add_cart_json").length === 0 && OUT_RE.test(area.text())) inStock = false;
  }
  return { ref, title, price, inStock };
}

/** Parses /shop?search=... results. Each card links to /shop/<slug>-<id>. */
export function parseSearchResults(html: string): SupplierSearchHit[] {
  const $ = cheerio.load(html);
  const hits: SupplierSearchHit[] = [];
  const seen = new Set<string>();
  $(".oe_product, [itemprop='itemListElement'], .o_wsale_product_grid_wrapper").each((_, el) => {
    const a = $(el).find('a[href*="/shop/"]').filter((__, x) => /-\d+(\?|$)/.test($(x).attr("href") ?? "")).first();
    const ref = hub360RefFromUrl((a.attr("href") ?? "").split("?")[0]);
    if (!ref || seen.has(ref)) return;
    seen.add(ref);
    const title =
      $(el).find('[itemprop="name"], .o_wsale_products_item_title a, h6 a').first().text().trim() ||
      a.attr("title")?.trim() ||
      a.text().trim();
    const price = parsePrice($(el).find(".oe_currency_value").first().text());
    hits.push({ supplier: "hub360", ref, title, price, inStock: null, url: ref });
  });
  return hits;
}

/** Serialises requests so Hub360 never sees more than one per interval. */
export function makeRateLimited(fetchFn: Fetcher, sleep: Sleep, intervalMs = HUB360_MIN_INTERVAL_MS, clock: () => number = Date.now): Fetcher {
  let last = Number.NEGATIVE_INFINITY;
  let chain: Promise<unknown> = Promise.resolve();
  const limited = ((input: RequestInfo | URL, init?: RequestInit) => {
    const run = chain.then(async () => {
      const wait = last + intervalMs - clock();
      if (wait > 0) await sleep(wait);
      last = clock();
      return fetchFn(input, init);
    });
    chain = run.catch(() => undefined);
    return run;
  }) as Fetcher;
  return limited;
}

export const defaultSleep: Sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function fetchHub360Page(ref: string, fetchFn: Fetcher): Promise<Observation> {
  const res = await fetchFn(ref, { headers: { "user-agent": userAgent(), accept: "text/html" }, redirect: "follow" });
  if (res.status === 404) throw new Error("Product page not found (404). Re-link this listing.");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return parseProductPage(await res.text(), ref);
}

let shared: Fetcher | null = null;
/** Shared limiter for in-app searches so concurrent clicks still respect 1 request/second. */
export function sharedHub360Fetch(): Fetcher {
  return (shared ??= makeRateLimited(fetch, defaultSleep));
}

export async function searchHub360(q: string, fetchFn: Fetcher = sharedHub360Fetch()): Promise<SupplierSearchHit[]> {
  const direct = hub360RefFromUrl(q);
  if (direct) {
    const obs = await fetchHub360Page(direct, fetchFn);
    return [{ supplier: "hub360", ref: direct, title: obs.title, price: obs.price, inStock: obs.inStock, url: direct }];
  }
  if (/^https?:\/\//i.test(q.trim())) throw new Error("That is not a Hub360 product URL (it should look like https://hub360.cc/shop/name-12345)");
  const res = await fetchFn(`${HUB360_ORIGIN}/shop?search=${encodeURIComponent(q.trim())}`, {
    headers: { "user-agent": userAgent(), accept: "text/html" },
  });
  if (!res.ok) throw new Error(`Hub360 search: HTTP ${res.status}`);
  return parseSearchResults(await res.text()).slice(0, 25);
}
