"use client";
import { useMemo, useState, useTransition } from "react";
import { formatNaira, priceBundle, priceComponent, type ListingPrice } from "@/lib/pricing";
import { saveBundleItems } from "../actions";

interface Comp { id: number; name: string; category: string; markupPct: number; active: boolean; listings: ListingPrice[] }
interface Item { componentId: number; quantity: number }

export default function BundleEditor({ bundleId, nowIso, staleAfterHours, components, initialItems }: { bundleId: number; nowIso: string; staleAfterHours: number; components: Comp[]; initialItems: Item[] }) {
  const [items, setItems] = useState<Item[]>(initialItems);
  const [q, setQ] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const opts = useMemo(() => ({ now: new Date(nowIso), staleAfterHours }), [nowIso, staleAfterHours]);
  const byId = useMemo(() => new Map(components.map((c) => [c.id, c])), [components]);
  const hits = q.trim() ? components.filter((c) => c.active && c.name.toLowerCase().includes(q.trim().toLowerCase()) && !items.some((i) => i.componentId === c.id)).slice(0, 8) : [];
  const priced = priceBundle(items.flatMap((i) => { const c = byId.get(i.componentId); return c ? [{ componentId: c.id, name: c.name, markupPct: c.markupPct, listings: c.listings, quantity: i.quantity }] : []; }), 1, opts);

  function save() {
    setMsg(null);
    start(async () => {
      const r = await saveBundleItems(bundleId, items);
      setMsg("error" in r ? r.error : "Saved.");
    });
  }

  return (
    <section className="card stack">
      <h2>Components</h2>
      <label>Add a component
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name" />
      </label>
      {hits.length > 0 && (
        <div className="table-wrap"><table><tbody>
          {hits.map((c) => (
            <tr key={c.id}><td>{c.name} <span className="muted small">{c.category}</span></td>
              <td className="num"><button type="button" className="btn small" onClick={() => { setItems([...items, { componentId: c.id, quantity: 1 }]); setQ(""); }}>Add</button></td></tr>
          ))}
        </tbody></table></div>
      )}
      <div className="table-wrap"><table>
        <thead><tr><th>Component</th><th className="num">Qty</th><th className="num">Unit price</th><th className="num">Subtotal</th><th></th></tr></thead>
        <tbody>
          {items.length === 0 && <tr><td colSpan={5} className="muted">Empty. Search above to add components.</td></tr>}
          {items.map((i, idx) => {
            const c = byId.get(i.componentId);
            const p = c ? priceComponent(c.listings, c.markupPct, i.quantity, opts) : null;
            return (
              <tr key={i.componentId}>
                <td>{c?.name ?? "Removed component"} {c && !c.active && <span className="badge neutral">Inactive</span>}
                  {p && p.warnings.length > 0 && <ul className="warnings">{p.warnings.map((w, k) => <li key={k}>{w.message}</li>)}</ul>}</td>
                <td className="num"><input className="qty" type="number" min={1} value={i.quantity} aria-label={`Quantity for ${c?.name}`} onChange={(e) => setItems(items.map((x, k) => (k === idx ? { ...x, quantity: Math.max(1, Math.floor(Number(e.target.value)) || 1) } : x)))} /></td>
                <td className="num">{p ? formatNaira(p.unitPrice) : "-"}</td>
                <td className="num">{p ? formatNaira(p.lineTotal) : "-"}</td>
                <td><button type="button" className="btn small danger" onClick={() => setItems(items.filter((_, k) => k !== idx))}>Remove</button></td>
              </tr>
            );
          })}
        </tbody>
        <tfoot><tr><td colSpan={3}>Bundle price (no extra markup)</td><td className="num">{formatNaira(priced.unitPrice)}</td><td></td></tr></tfoot>
      </table></div>
      <div className="row">
        <button type="button" className="btn primary" onClick={save} disabled={pending}>{pending ? "Saving..." : "Save components"}</button>
        {msg && <span role="status" className="notice">{msg}</span>}
      </div>
    </section>
  );
}
