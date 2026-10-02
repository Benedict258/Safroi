import { requireAdmin } from "@/lib/auth";
import { loadComponents } from "@/lib/catalog";
import { priceComponent } from "@/lib/pricing";
import { getSettings } from "@/lib/settings";

const esc = (v: unknown) => {
  let s = v === null || v === undefined ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // stop spreadsheet formula injection
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export async function GET() {
  try {
    await requireAdmin();
  } catch {
    return new Response("Not signed in", { status: 401 });
  }
  const [comps, settings] = await Promise.all([loadComponents(), getSettings()]);
  const now = new Date();
  const header = [
    "id", "name", "category", "unit_label", "markup_pct", "active",
    "microscale_price", "microscale_units", "microscale_in_stock", "microscale_synced_at",
    "hub360_price", "hub360_units", "hub360_in_stock", "hub360_synced_at",
    "supplier_used", "unit_price_ngn",
  ];
  const rows = comps.map((c) => {
    const m = c.listings.find((l) => l.supplier === "microscale");
    const h = c.listings.find((l) => l.supplier === "hub360");
    const p = priceComponent(c.listings, c.markupPct, 1, { now, staleAfterHours: settings.staleAfterHours });
    return [
      c.id, c.name, c.category, c.unitLabel, c.markupPct, c.active,
      m?.price, m?.unitsPerListing, m?.inStock, m?.lastSyncedAt,
      h?.price, h?.unitsPerListing, h?.inStock, h?.lastSyncedAt,
      p.supplierUsed, p.supplierUsed ? p.unitPrice : "",
    ];
  });
  const csv = [header, ...rows].map((r) => r.map(esc).join(",")).join("\r\n");
  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="catalog-${now.toISOString().slice(0, 10)}.csv"`,
    },
  });
}
