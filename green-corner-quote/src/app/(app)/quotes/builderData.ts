import { loadBundles, loadComponents } from "@/lib/catalog";
import { getSettings } from "@/lib/settings";
import type { BuilderCatalog } from "./QuoteBuilder";

export async function loadBuilderCatalog(): Promise<BuilderCatalog> {
  const [components, bundles, settings] = await Promise.all([loadComponents({ activeOnly: true }), loadBundles({ activeOnly: true }), getSettings()]);
  const byId = new Map(components.map((c) => [c.id, c]));
  return {
    nowIso: new Date().toISOString(),
    staleAfterHours: settings.staleAfterHours,
    components: components.map((c) => ({
      id: c.id, name: c.name, category: c.category, markupPct: c.markupPct,
      listings: c.listings.map((l) => ({ supplier: l.supplier, price: l.price, inStock: l.inStock, unitsPerListing: l.unitsPerListing, status: l.status, lastSyncedAt: l.lastSyncedAt })),
    })),
    bundles: bundles
      .map((b) => ({ id: b.id, name: b.name, items: b.items.filter((i) => byId.has(i.componentId)).map((i) => ({ componentId: i.componentId, quantity: i.quantity })) }))
      .filter((b) => b.items.length > 0),
  };
}
