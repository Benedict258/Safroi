import Link from "next/link";
import { loadBundles, loadComponents } from "@/lib/catalog";
import { priceBundle, formatNaira } from "@/lib/pricing";
import { getSettings } from "@/lib/settings";
import { Badge } from "@/components/Badges";

export const metadata = { title: "Bundles" };

export default async function BundlesPage() {
  const [bundles, comps, settings] = await Promise.all([loadBundles(), loadComponents(), getSettings()]);
  const byId = new Map(comps.map((c) => [c.id, c]));
  const opts = { now: new Date(), staleAfterHours: settings.staleAfterHours };
  return (
    <>
      <div className="page-head">
        <h1>Bundles</h1>
        <div><Link className="btn primary" href="/bundles/new">New bundle</Link></div>
      </div>
      <p className="muted">A bundle's price is the sum of its components' unit prices. It updates whenever supplier prices change.</p>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Bundle</th><th>Components</th><th className="num">Price</th></tr></thead>
          <tbody>
            {bundles.length === 0 && <tr><td colSpan={3} className="muted">No bundles yet.</td></tr>}
            {bundles.map((b) => {
              const p = priceBundle(b.items.flatMap((i) => { const c = byId.get(i.componentId); return c ? [{ componentId: c.id, name: c.name, markupPct: c.markupPct, listings: c.listings, quantity: i.quantity }] : []; }), 1, opts);
              return (
                <tr key={b.id}>
                  <td><Link href={`/bundles/${b.id}`}>{b.name}</Link> {!b.active && <Badge kind="neutral">Inactive</Badge>}</td>
                  <td>{b.items.length}</td>
                  <td className="num">{formatNaira(p.unitPrice)} {p.warnings.length > 0 && <Badge kind="warn">{p.warnings.length} warning(s)</Badge>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
