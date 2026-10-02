import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { fetchMicroscaleFeed, microscaleHandleFromUrl, parseProductsJson, splitMicroscaleRef } from "../src/lib/sync/microscale";
import { hub360ProductId, hub360RefFromUrl, makeRateLimited, parseProductPage, parseSearchResults } from "../src/lib/sync/hub360";
import { decide } from "../src/lib/sync/safeguards";
import { latestDueSlot } from "../src/lib/time";
import { parsePrice } from "../src/lib/sync/types";

const fx = (n: string) => readFileSync(new URL(`./fixtures/${n}`, import.meta.url), "utf8");

describe("Microscale parser", () => {
  const obs = parseProductsJson(JSON.parse(fx("microscale-products.json")));
  const get = (ref: string) => obs.find((o) => o.ref === ref);
  it("reads price and stock per SKU", () => {
    expect(get("arduino-uno-r3#ARD-UNO-R3")).toMatchObject({ price: 12500, inStock: true, title: "Arduino Uno R3" });
    expect(get("waterproof-project-case#CASE-L")).toMatchObject({ price: 14200, inStock: false });
    expect(get("waterproof-project-case#CASE-S")?.title).toBe("Waterproof Project Case (Small)");
  });
  it("offers a handle-only ref for the first variant", () => {
    expect(get("arduino-uno-r3")?.price).toBe(12500);
  });
  it("turns a zero price into null instead of a price", () => {
    expect(get("jumper-wires-40")?.price).toBeNull();
  });
  it("fails loudly when the feed shape changes", () => {
    expect(() => parseProductsJson({ items: [] })).toThrow(/products/);
  });
  it("splits refs and URLs", () => {
    expect(splitMicroscaleRef("a-b#SKU1")).toEqual({ handle: "a-b", sku: "SKU1" });
    expect(splitMicroscaleRef("a-b")).toEqual({ handle: "a-b", sku: null });
    expect(microscaleHandleFromUrl("https://www.microscale.net/products/arduino-uno-r3?variant=1")).toBe("arduino-uno-r3");
    expect(microscaleHandleFromUrl("https://example.com/products/x")).toBeNull();
  });
  it("pages until an empty page", async () => {
    const pages = [JSON.parse(fx("microscale-products.json")), { products: [] }];
    let i = 0;
    const fake = (async () => ({ ok: true, status: 200, json: async () => pages[i++] })) as unknown as typeof fetch;
    const all = await fetchMicroscaleFeed(fake);
    expect(i).toBe(2);
    expect(all.length).toBeGreaterThan(3);
  });
});

describe("Hub360 parser", () => {
  const ref = "https://hub360.cc/shop/arduino-uno-r3-18006";
  it("reads JSON-LD price and stock", () => {
    expect(parseProductPage(fx("hub360-product-jsonld.html"), ref)).toMatchObject({ price: 11900, inStock: true, title: "Arduino Uno R3" });
  });
  it("falls back to the printed price and the stock message", () => {
    expect(parseProductPage(fx("hub360-product-printed.html"), ref)).toMatchObject({ price: 1250, inStock: false });
  });
  it("returns a null price when the page has none", () => {
    expect(parseProductPage(fx("hub360-product-noprice.html"), ref).price).toBeNull();
  });
  it("parses search cards and ignores category links", () => {
    const hits = parseSearchResults(fx("hub360-search.html"));
    expect(hits.map((h) => h.ref)).toEqual(["https://hub360.cc/shop/arduino-uno-r3-18006", "https://hub360.cc/shop/arduino-nano-18010"]);
    expect(hits[0]).toMatchObject({ title: "Arduino Uno R3", price: 11900 });
  });
  it("accepts only Hub360 product URLs", () => {
    expect(hub360RefFromUrl("https://hub360.cc/shop/arduino-uno-r3-18006?x=1")).toBe(ref);
    expect(hub360RefFromUrl("https://hub360.cc/shop/category/boards-3")).toBeNull();
    expect(hub360RefFromUrl("https://evil.example/shop/a-1")).toBeNull();
    expect(hub360ProductId(ref)).toBe("18006");
  });
  it("never sends more than one request per second", async () => {
    let t = 0;
    const times: number[] = [];
    const fake = (async () => { times.push(t); return {} as Response; }) as unknown as typeof fetch;
    const f = makeRateLimited(fake, async (ms) => { t += ms; }, 1000, () => t);
    await Promise.all([f("a"), f("b"), f("c")]);
    expect(times[1] - times[0]).toBeGreaterThanOrEqual(1000);
    expect(times[2] - times[1]).toBeGreaterThanOrEqual(1000);
  });
});

describe("safeguards", () => {
  it("never accepts missing, zero or non-numeric prices", () => {
    expect(decide(1000, null, 30).kind).toBe("error");
    expect(decide(1000, 0, 30).kind).toBe("error");
    expect(decide(1000, NaN, 30).kind).toBe("error");
    expect(parsePrice("call us")).toBeNull();
  });
  it("accepts a first price, no-ops on equal, updates small moves", () => {
    expect(decide(null, 500, 30).kind).toBe("first");
    expect(decide(1000, 1000, 30).kind).toBe("unchanged");
    expect(decide(1000, 1200, 30).kind).toBe("update");
  });
  it("holds a jump above the threshold, in both directions", () => {
    expect(decide(1000, 1400, 30)).toMatchObject({ kind: "hold", newPrice: 1400 });
    expect(decide(1000, 600, 30).kind).toBe("hold");
    expect(decide(1000, 1300, 30).kind).toBe("update"); // exactly 30% passes
  });
});

describe("sync schedule", () => {
  const times = ["06:00", "18:00"];
  it("finds the latest slot in Lagos time (UTC+1)", () => {
    expect(latestDueSlot(times, new Date("2026-10-02T05:30:00Z"))?.toISOString()).toBe("2026-10-02T05:00:00.000Z"); // 06:30 Lagos
    expect(latestDueSlot(times, new Date("2026-10-02T04:30:00Z"))?.toISOString()).toBe("2026-10-01T17:00:00.000Z"); // 05:30 Lagos -> yesterday 18:00
    expect(latestDueSlot(times, new Date("2026-10-02T17:10:00Z"))?.toISOString()).toBe("2026-10-02T17:00:00.000Z");
  });
});
