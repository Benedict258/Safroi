import Link from "next/link";
import { loadCategories, loadComponents } from "@/lib/catalog";
import { priceComponent, formatNaira } from "@/lib/pricing";
import { getSettings } from "@/lib/settings";
import { Badge } from "@/components/Badges";
import { PriceCell } from "@/components/PriceCell";

export const metadata = { title: "Catalog" };

export default async function CatalogPage({ searchParams }: { searchParams: Promise<{ q?: string; category?: string; inactive?: string }> }) {
  const sp = await searchParams;
  const [comps, cats, settings] = await Promise.all([
    loadComponents({ q: sp.q, category: sp.category }),
    loadCategories(),
    getSettings(),
  ]);
  const now = new Date();
  const shown = sp.inactive ? comps : comps.filter((c) => c.active);
  return (
    <>
      <div className="page-head">
        <h1>Catalog</h1>
        <div>
          <a className="btn" href="/api/catalog/export">Export CSV</a>
          <Link className="btn primary" href="/catalog/new">New component</Link>
        </div>
      </div>
      <form className="row card" method="get">
        <label>Search<input name="q" defaultValue={sp.q} placeholder="Name or description" /></label>
        <label>Category
          <select name="category" defaultValue={sp.category ?? ""}>
            <option value="">All categories</option>
            {cats.map((c) => <option key={c}>{c}</option>)}
          </select>
        </label>
        <label style={{ flexDirection: "row", alignItems: "center", flex: "0 0 auto" }}>
          <input type="checkbox" name="inactive" value="1" defaultChecked={!!sp.inactive} /> Show inactive
        </label>
        <button className="btn">Filter</button>
      </form>
      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>Component</th><th>Category</th><th className="num">Markup</th><th>Microscale</th><th>Hub360</th><th className="num">Our unit price</th></tr>
          </thead>
          <tbody>
            {shown.length === 0 && <tr><td colSpan={6} className="muted">No components yet. Add one to start quoting.</td></tr>}
            {shown.map((c) => {
              const p = priceComponent(c.listings, c.markupPct, 1, { now, staleAfterHours: settings.staleAfterHours });
              return (
                <tr key={c.id}>
                  <td><Link href={`/catalog/${c.id}`}>{c.name}</Link>{!c.active && <> <Badge kind="neutral">Inactive</Badge></>}</td>
                  <td>{c.category}</td>
                  <td className="num">{c.markupPct}%</td>
                  <td><PriceCell l={c.listings.find((l) => l.supplier === "microscale")} now={now} staleAfterHours={settings.staleAfterHours} /></td>
                  <td><PriceCell l={c.listings.find((l) => l.supplier === "hub360")} now={now} staleAfterHours={settings.staleAfterHours} /></td>
                  <td className="num">{p.supplierUsed ? formatNaira(p.unitPrice) : "-"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
