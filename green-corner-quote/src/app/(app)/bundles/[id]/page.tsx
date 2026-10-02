import { notFound } from "next/navigation";
import Link from "next/link";
import { loadBundles, loadComponents } from "@/lib/catalog";
import { getSettings } from "@/lib/settings";
import { deleteBundle, setBundleActive, updateBundle } from "../actions";
import ConfirmButton from "@/components/ConfirmButton";
import BundleEditor from "./BundleEditor";

export const metadata = { title: "Bundle" };

export default async function BundlePage({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();
  const b = (await loadBundles({ ids: [id] }))[0];
  if (!b) notFound();
  const [comps, settings] = await Promise.all([loadComponents({ activeOnly: true }), getSettings()]);
  const all = await loadComponents({ ids: b.items.map((i) => i.componentId) });
  const known = new Map([...comps, ...all].map((c) => [c.id, c]));
  return (
    <>
      <div className="page-head">
        <h1>{b.name}</h1>
        <div>
          <Link className="btn" href="/bundles">Back</Link>
          <form action={setBundleActive.bind(null, b.id, !b.active)}><button className="btn">{b.active ? "Deactivate" : "Reactivate"}</button></form>
          <form action={deleteBundle.bind(null, b.id)}><ConfirmButton message="Delete this bundle? Saved quotes keep their prices.">Delete</ConfirmButton></form>
        </div>
      </div>
      <form action={updateBundle.bind(null, b.id)} className="stack card">
        <label>Name<input name="name" defaultValue={b.name} required maxLength={200} /></label>
        <label>Description<textarea name="description" rows={2} defaultValue={b.description} maxLength={1000} /></label>
        <div><button className="btn">Save details</button></div>
      </form>
      <BundleEditor
        bundleId={b.id}
        nowIso={new Date().toISOString()}
        staleAfterHours={settings.staleAfterHours}
        components={[...known.values()].map((c) => ({ id: c.id, name: c.name, category: c.category, markupPct: c.markupPct, active: c.active, listings: c.listings.map((l) => ({ supplier: l.supplier, price: l.price, inStock: l.inStock, unitsPerListing: l.unitsPerListing, status: l.status, lastSyncedAt: l.lastSyncedAt })) }))}
        initialItems={b.items.map((i) => ({ componentId: i.componentId, quantity: i.quantity }))}
      />
    </>
  );
}
