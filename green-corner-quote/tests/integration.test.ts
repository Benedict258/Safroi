// Runs against a real Postgres. Skipped unless TEST_DATABASE_URL is set. WARNING: wipes that database's data.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

d("sync + quotes against Postgres", () => {
  let db: typeof import("../src/lib/db");
  let run: typeof import("../src/lib/sync/run");
  let quotes: typeof import("../src/lib/quotes");
  let catalog: typeof import("../src/lib/catalog");

  let feedPrice = 12500;
  const feed = (price: number, available = true) =>
    ({ products: [{ handle: "arduino-uno-r3", title: "Arduino Uno R3", variants: [{ sku: "UNO", title: "Default Title", price: String(price), available }] }] });
  const fakeFeed = (async (u: string) => {
    const page = new URL(u).searchParams.get("page");
    return { ok: true, status: 200, json: async () => (page === "1" ? feed(feedPrice) : { products: [] }) };
  }) as unknown as typeof fetch;

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    db = await import("../src/lib/db");
    await db.query("drop schema public cascade; create schema public;");
    await (await import("../src/lib/migrate")).migrate();
    run = await import("../src/lib/sync/run");
    quotes = await import("../src/lib/quotes");
    catalog = await import("../src/lib/catalog");
  });
  afterAll(async () => db?.closePool());

  let compId = 0;
  beforeEach(async () => {
    await db.query("truncate components, bundles, quotes, sync_runs restart identity cascade");
    feedPrice = 12500;
    compId = (await db.query("insert into components (name, category) values ('Arduino Uno R3', 'Boards') returning id"))[0].id;
    await db.query("insert into supplier_listings (component_id, supplier, supplier_ref) values ($1, 'microscale', 'arduino-uno-r3#UNO')", [compId]);
  });

  const sync = () => run.runSync({ supplier: "microscale", trigger: "manual", fetchFn: fakeFeed });
  const listing = async () => (await catalog.loadComponent(compId))!.listings[0];

  it("fetches the first price and stock", async () => {
    const r = await sync();
    expect(r).toMatchObject({ status: "success", updated: 1, failed: 0 });
    expect(await listing()).toMatchObject({ price: 12500, inStock: true, status: "ok" });
    expect((await db.query("select * from price_history")).length).toBe(1);
  });

  it("applies a small change but holds a forced 40% jump for review", async () => {
    await sync();
    feedPrice = 13000;
    await sync();
    expect((await listing()).price).toBe(13000);
    feedPrice = 18200; // +40%
    await sync();
    const l = await listing();
    expect(l.price).toBe(13000);
    expect(l.status).toBe("held");
    const held = await db.query("select * from held_changes where decision = 'pending'");
    expect(held).toHaveLength(1);
    await run.decideHeldChange(held[0].id, "approved");
    expect(await listing()).toMatchObject({ price: 18200, status: "ok" });
  });

  it("does not re-queue a rejected jump", async () => {
    await sync();
    feedPrice = 18200;
    await sync();
    const [h] = await db.query("select id from held_changes");
    await run.decideHeldChange(h.id, "rejected");
    await sync();
    expect(await db.query("select 1 from held_changes where decision = 'pending'")).toHaveLength(0);
    expect((await listing()).price).toBe(12500);
  });

  it("keeps the last good price when the feed drops the item or gives zero", async () => {
    await sync();
    feedPrice = 0;
    const r = await sync();
    expect(r.status).toBe("failed");
    expect(await listing()).toMatchObject({ price: 12500, status: "error" });
  });

  it("skips when another run holds the supplier lock", async () => {
    const c = await db.getPool().connect();
    await c.query("select pg_advisory_lock(7731, 1)");
    try {
      expect((await sync()).status).toBe("skipped");
    } finally {
      await c.query("select pg_advisory_unlock(7731, 1)");
      c.release();
    }
  });

  it("saved quotes keep their prices after a sync; quantity changes keep the snapshot", async () => {
    await sync();
    const id = await quotes.saveQuote(null, "School A", "", [{ kind: "component", refId: compId, quantity: 4 }]);
    expect((await quotes.loadQuote(id))!.total).toBe(55000);
    feedPrice = 14000;
    await sync();
    let q = (await quotes.loadQuote(id))!;
    expect(q.total).toBe(55000);
    // edit quantity: snapshot unit price is kept
    await quotes.saveQuote(id, "School A", "", [{ lineId: q.lines[0].id, kind: "component", refId: compId, quantity: 5 }]);
    q = (await quotes.loadQuote(id))!;
    expect(q.lines[0].unitPrice).toBe(13750);
    expect(q.total).toBe(68750);
    // reprice picks up today's price
    await quotes.saveQuote(id, "School A", "", [{ lineId: q.lines[0].id, kind: "component", refId: compId, quantity: 5, reprice: true }]);
    expect((await quotes.loadQuote(id))!.lines[0].unitPrice).toBe(15400);
    // duplicate prices at today's prices
    const copy = await quotes.duplicateQuote(id);
    expect((await quotes.loadQuote(copy))!.total).toBe(77000);
  });

  it("prices a bundle live from its components", async () => {
    await sync();
    const b = (await db.query("insert into bundles (name) values ('Starter kit') returning id"))[0].id;
    await db.query("insert into bundle_items (bundle_id, component_id, quantity) values ($1, $2, 2)", [b, compId]);
    const id = await quotes.saveQuote(null, "Kit", "", [{ kind: "bundle", refId: b, quantity: 3 }]);
    const q = (await quotes.loadQuote(id))!;
    expect(q.lines[0].unitPrice).toBe(27500);
    expect(q.total).toBe(82500);
  });
});
