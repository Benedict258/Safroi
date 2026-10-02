import { notFound } from "next/navigation";
import Link from "next/link";
import { loadCategories, loadComponent } from "@/lib/catalog";
import { getSettings } from "@/lib/settings";
import { formatLagos } from "@/lib/time";
import { query } from "@/lib/db";
import { formatNaira, SUPPLIER_LABEL, SUPPLIERS } from "@/lib/pricing";
import { ListingBadges, Badge } from "@/components/Badges";
import ComponentForm from "../ComponentForm";
import ListingLinker from "./ListingLinker";
import { deleteComponent, setComponentActive, updateComponent } from "../actions";
import ConfirmButton from "@/components/ConfirmButton";

export const metadata = { title: "Component" };

export default async function ComponentPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> }) {
  const id = Number((await params).id);
  const sp = await searchParams;
  if (!Number.isInteger(id)) notFound();
  const c = await loadComponent(id);
  if (!c) notFound();
  const [cats, settings, history] = await Promise.all([
    loadCategories(),
    getSettings(),
    query(
      `select h.price_ngn, h.in_stock, h.captured_at, l.supplier from price_history h join supplier_listings l on l.id = h.listing_id
       where l.component_id = $1 order by h.captured_at desc limit 15`, [id]),
  ]);
  const now = new Date();
  return (
    <>
      <div className="page-head">
        <h1>{c.name} {!c.active && <Badge kind="neutral">Inactive</Badge>}</h1>
        <div>
          <Link className="btn" href="/catalog">Back to catalog</Link>
          <form action={setComponentActive.bind(null, c.id, !c.active)}><button className="btn">{c.active ? "Deactivate" : "Reactivate"}</button></form>
          <form action={deleteComponent.bind(null, c.id)}><ConfirmButton message="Delete this component and its supplier links? Saved quotes keep their prices.">Delete</ConfirmButton></form>
        </div>
      </div>
      {sp.error === "in-bundle" && <p className="error card" role="alert">This component is used in a bundle. Remove it from the bundle first, or deactivate it instead.</p>}
      <datalist id="cats">{cats.map((x) => <option key={x} value={x} />)}</datalist>
      <ComponentForm c={c} action={updateComponent.bind(null, c.id)} submitLabel="Save changes" />

      <h2>Supplier listings</h2>
      {SUPPLIERS.map((s) => {
        const l = c.listings.find((x) => x.supplier === s);
        return (
          <section className="card" key={s}>
            <h3>{SUPPLIER_LABEL[s]}</h3>
            {l ? (
              <p>
                <strong>{l.title ?? l.supplierRef}</strong>{" "}
                <span className="muted small">({l.supplierRef})</span><br />
                {l.price !== null ? <>{formatNaira(l.price)} per listing</> : "No price yet"} · <ListingBadges l={l} now={now} staleAfterHours={settings.staleAfterHours} />
                <br /><span className="muted small">Last synced {formatLagos(l.lastSyncedAt)}{l.lastError ? ` · ${l.lastError}` : ""}</span>
              </p>
            ) : <p className="muted">Not linked.</p>}
            <ListingLinker componentId={c.id} supplier={s} current={l ? { id: l.id, units: l.unitsPerListing } : null} />
          </section>
        );
      })}

      {history.length > 0 && (
        <>
          <h2>Recent price changes</h2>
          <div className="table-wrap"><table>
            <thead><tr><th>When</th><th>Supplier</th><th className="num">Price</th><th>Stock</th></tr></thead>
            <tbody>{history.map((h, i) => (
              <tr key={i}><td>{formatLagos(h.captured_at)}</td><td>{SUPPLIER_LABEL[h.supplier as "microscale"]}</td><td className="num">{formatNaira(h.price_ngn)}</td><td>{h.in_stock ? "In stock" : "Out of stock"}</td></tr>
            ))}</tbody>
          </table></div>
        </>
      )}
    </>
  );
}
