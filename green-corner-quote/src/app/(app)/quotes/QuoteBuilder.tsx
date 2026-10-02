"use client";
import Link from "next/link";
import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatNaira, priceBundle, priceComponent, SUPPLIER_LABEL, type ListingPrice, type Supplier, type Warning } from "@/lib/pricing";
import { ListingBadges } from "@/components/Badges";
import { saveQuoteAction } from "./actions";

export interface BuilderCatalog {
  nowIso: string;
  staleAfterHours: number;
  components: { id: number; name: string; category: string; markupPct: number; listings: ListingPrice[] }[];
  bundles: { id: number; name: string; items: { componentId: number; quantity: number }[] }[];
}
export interface InitialLine {
  lineId: number;
  kind: "component" | "bundle";
  refId: number;
  name: string;
  quantity: number;
  supplierUsed: Supplier | null;
  unitPrice: number;
  markupPct: number | null;
  warnings: Warning[];
  detail: { name: string; quantity: number; unitPrice: number; lineTotal: number }[] | null;
}
export interface InitialQuote { id: number | null; name: string; notes: string; lines: InitialLine[] }

interface Line {
  key: string;
  kind: "component" | "bundle";
  refId: number;
  quantity: number;
  override: Supplier | null;
  reprice: boolean;
  frozen: InitialLine | null;
}

let seq = 0;
const newKey = () => `l${++seq}`;

export default function QuoteBuilder({ catalog, initial }: { catalog: BuilderCatalog; initial: InitialQuote }) {
  const router = useRouter();
  const [name, setName] = useState(initial.name);
  const [notes, setNotes] = useState(initial.notes);
  const [lines, setLines] = useState<Line[]>(() =>
    initial.lines.map((l) => ({ key: newKey(), kind: l.kind, refId: l.refId, quantity: l.quantity, override: null, reprice: false, frozen: l })),
  );
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [pending, start] = useTransition();
  const now = useMemo(() => new Date(catalog.nowIso), [catalog.nowIso]);
  const opts = { now, staleAfterHours: catalog.staleAfterHours };
  const comps = useMemo(() => new Map(catalog.components.map((c) => [c.id, c])), [catalog]);
  const bundles = useMemo(() => new Map(catalog.bundles.map((b) => [b.id, b])), [catalog]);

  const change = (fn: (l: Line[]) => Line[]) => { setLines(fn); setDirty(true); };

  function add(kind: "component" | "bundle", refId: number) {
    change((ls) => {
      const hit = ls.find((l) => l.kind === kind && l.refId === refId);
      if (hit) return ls.map((l) => (l === hit ? { ...l, quantity: l.quantity + 1 } : l));
      return [...ls, { key: newKey(), kind, refId, quantity: 1, override: null, reprice: false, frozen: null }];
    });
  }
  const patch = (key: string, p: Partial<Line>) => change((ls) => ls.map((l) => (l.key === key ? { ...l, ...p } : l)));

  const rows = lines.map((l) => {
    const frozenActive = !!l.frozen && !l.reprice && (!l.override || l.override === l.frozen.supplierUsed);
    if (l.kind === "component") {
      const c = comps.get(l.refId);
      const live = c ? priceComponent(c.listings, c.markupPct, l.quantity, { ...opts, override: l.override }) : null;
      if (frozenActive && l.frozen) {
        return { l, name: l.frozen.name, c, supplierUsed: l.frozen.supplierUsed, markup: l.frozen.markupPct, unit: l.frozen.unitPrice, total: l.frozen.unitPrice * l.quantity, warnings: l.frozen.warnings, breakdown: null, frozen: true, gone: !c };
      }
      if (!c || !live) return { l, name: l.frozen?.name ?? "Removed component", c, supplierUsed: null, markup: null, unit: 0, total: 0, warnings: [{ code: "no_price", message: "This component was removed or deactivated." } as Warning], breakdown: null, frozen: false, gone: true };
      return { l, name: c.name, c, supplierUsed: live.supplierUsed, markup: c.markupPct, unit: live.unitPrice, total: live.lineTotal, warnings: live.warnings, breakdown: null, frozen: false, gone: false };
    }
    const b = bundles.get(l.refId);
    if (frozenActive && l.frozen) {
      return { l, name: l.frozen.name, c: undefined, supplierUsed: null, markup: null, unit: l.frozen.unitPrice, total: l.frozen.unitPrice * l.quantity, warnings: l.frozen.warnings, breakdown: l.frozen.detail, frozen: true, gone: !b };
    }
    if (!b) return { l, name: l.frozen?.name ?? "Removed bundle", c: undefined, supplierUsed: null, markup: null, unit: 0, total: 0, warnings: [{ code: "no_price", message: "This bundle was removed or deactivated." } as Warning], breakdown: null, frozen: false, gone: true };
    const items = b.items.map((i) => { const c = comps.get(i.componentId)!; return { componentId: c.id, name: c.name, markupPct: c.markupPct, listings: c.listings, quantity: i.quantity }; });
    const p = priceBundle(items, l.quantity, opts);
    return { l, name: b.name, c: undefined, supplierUsed: null, markup: null, unit: p.unitPrice, total: p.lineTotal, warnings: p.warnings, breakdown: p.breakdown, frozen: false, gone: false };
  });
  const total = rows.reduce((s, r) => s + r.total, 0);

  function save() {
    setError(null);
    if (!name.trim()) return setError("Give the quote a name first.");
    if (lines.length === 0) return setError("Add at least one item.");
    start(async () => {
      const res = await saveQuoteAction(
        initial.id, name, notes,
        lines.map((l) => ({ lineId: l.frozen?.lineId ?? null, kind: l.kind, refId: l.refId, quantity: l.quantity, override: l.override, reprice: l.reprice })),
      );
      if ("error" in res) return setError(res.error);
      setDirty(false);
      router.push(`/quotes/${res.id}/view`);
    });
  }

  return (
    <>
      <div className="page-head">
        <h1>{initial.id ? "Edit quote" : "New quote"}</h1>
        <div>
          <Link className="btn" href={initial.id ? `/quotes/${initial.id}/view` : "/quotes"}>{dirty ? "Discard" : "Back"}</Link>
          {initial.id && lines.some((l) => l.frozen) && (
            <button type="button" className="btn" onClick={() => change((ls) => ls.map((l) => ({ ...l, reprice: true })))} title="Replace saved prices with today's prices">Reprice all</button>
          )}
          <button type="button" className="btn primary" onClick={save} disabled={pending}>{pending ? "Saving..." : "Save quote"}</button>
        </div>
      </div>
      {error && <p className="error card" role="alert">{error}</p>}
      <div className="card stack">
        <div className="row">
          <label>Quote name (school or project)<input value={name} onChange={(e) => { setName(e.target.value); setDirty(true); }} maxLength={200} placeholder="e.g. GSS Minna, class of 30" /></label>
        </div>
        <label>Notes<textarea rows={2} value={notes} onChange={(e) => { setNotes(e.target.value); setDirty(true); }} maxLength={2000} /></label>
      </div>

      <Picker catalog={catalog} onAdd={add} />

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Item</th><th className="num">Qty</th><th>Microscale</th><th>Hub360</th><th>Supplier used</th>
              <th className="num">Markup</th><th className="num">Unit price</th><th className="num">Line total</th><th></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={9} className="muted">No items yet. Search above to add components or bundles.</td></tr>}
            {rows.map((r) => (
              <tr key={r.l.key}>
                <td>
                  <span className="line-name">{r.name}</span>{" "}
                  {r.l.kind === "bundle" && <span className="badge neutral">Bundle</span>}{" "}
                  {r.frozen && <span className="badge neutral" title="Saved price kept">Saved price</span>}
                  {r.frozen && !r.gone && <button type="button" className="btn small" onClick={() => patch(r.l.key, { reprice: true })}>Reprice</button>}
                  {r.warnings.length > 0 && <ul className="warnings">{r.warnings.map((w, i) => <li key={i}>{w.message}</li>)}</ul>}
                  {r.breakdown && (
                    <details><summary>Contents</summary>
                      <ul className="small">{r.breakdown.map((b, i) => <li key={i}>{b.quantity} × {b.name}: {formatNaira(b.lineTotal)}</li>)}</ul>
                    </details>
                  )}
                </td>
                <td className="num"><input className="qty" type="number" min={1} max={100000} value={r.l.quantity} aria-label={`Quantity for ${r.name}`} onChange={(e) => patch(r.l.key, { quantity: Math.max(1, Math.floor(Number(e.target.value)) || 1) })} /></td>
                {(["microscale", "hub360"] as Supplier[]).map((s) => {
                  const l = r.c?.listings.find((x) => x.supplier === s);
                  return (
                    <td key={s} className="price-cell">
                      {r.l.kind === "bundle" ? <span className="muted">-</span> : l ? (
                        <>
                          <span style={r.supplierUsed === s ? { fontWeight: 700 } : undefined}>{l.price !== null ? formatNaira(l.price) : "No price"}</span>
                          {l.unitsPerListing > 1 && l.price !== null && <small>pack of {l.unitsPerListing}</small>}
                          <ListingBadges l={l} now={now} staleAfterHours={catalog.staleAfterHours} />
                        </>
                      ) : <span className="muted">Not linked</span>}
                    </td>
                  );
                })}
                <td>
                  {r.l.kind === "component" && r.c ? (
                    <select aria-label={`Supplier for ${r.name}`} value={r.l.override ?? "auto"} onChange={(e) => patch(r.l.key, { override: e.target.value === "auto" ? null : (e.target.value as Supplier) })}>
                      <option value="auto">Auto{r.supplierUsed ? ` (${SUPPLIER_LABEL[r.supplierUsed]})` : ""}</option>
                      {r.c.listings.filter((l) => l.price !== null).map((l) => <option key={l.supplier} value={l.supplier}>{SUPPLIER_LABEL[l.supplier]}</option>)}
                    </select>
                  ) : <span className="muted">{r.l.kind === "bundle" ? "Per component" : "-"}</span>}
                </td>
                <td className="num">{r.markup !== null ? `${r.markup}%` : "-"}</td>
                <td className="num">{formatNaira(r.unit)}</td>
                <td className="num"><strong>{formatNaira(r.total)}</strong></td>
                <td><button type="button" className="btn small danger" aria-label={`Remove ${r.name}`} onClick={() => change((ls) => ls.filter((x) => x.key !== r.l.key))}>Remove</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="total-bar">
        <span className="muted">Total = sum of line totals. No delivery, VAT or other fees.</span>
        <strong aria-live="polite">{formatNaira(total)}</strong>
      </div>
    </>
  );
}

function Picker({ catalog, onAdd }: { catalog: BuilderCatalog; onAdd: (k: "component" | "bundle", id: number) => void }) {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("");
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const cats = useMemo(() => [...new Set(catalog.components.map((c) => c.category))].sort(), [catalog]);
  const needle = q.trim().toLowerCase();
  const opts = { now: new Date(catalog.nowIso), staleAfterHours: catalog.staleAfterHours };
  const compHits = catalog.components.filter((c) => (!cat || c.category === cat) && (!needle || c.name.toLowerCase().includes(needle))).slice(0, 15);
  const bundleHits = cat ? [] : catalog.bundles.filter((b) => !needle || b.name.toLowerCase().includes(needle)).slice(0, 8);

  return (
    <div className="card" ref={wrap} onBlur={(e) => { if (!wrap.current?.contains(e.relatedTarget as Node)) setOpen(false); }}>
      <div className="row">
        <label>Add a component or bundle
          <input value={q} onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} placeholder="Search by name" autoComplete="off" />
        </label>
        <label style={{ flex: "0 1 200px" }}>Category
          <select value={cat} onChange={(e) => { setCat(e.target.value); setOpen(true); }}>
            <option value="">All</option>
            {cats.map((c) => <option key={c}>{c}</option>)}
          </select>
        </label>
      </div>
      {open && (compHits.length > 0 || bundleHits.length > 0) && (
        <div className="picker"><div className="picker-list" role="listbox">
          {bundleHits.map((b) => (
            <button type="button" key={`b${b.id}`} onClick={() => onAdd("bundle", b.id)}>
              <span>{b.name} <span className="badge neutral">Bundle</span></span>
              <span className="muted">{formatNaira(priceBundle(b.items.map((i) => { const c = catalog.components.find((x) => x.id === i.componentId)!; return { componentId: c.id, name: c.name, markupPct: c.markupPct, listings: c.listings, quantity: i.quantity }; }), 1, opts).unitPrice)}</span>
            </button>
          ))}
          {compHits.map((c) => {
            const p = priceComponent(c.listings, c.markupPct, 1, opts);
            return (
              <button type="button" key={`c${c.id}`} onClick={() => onAdd("component", c.id)}>
                <span>{c.name} <span className="muted small">{c.category}</span></span>
                <span className="muted">{p.supplierUsed ? formatNaira(p.unitPrice) : "No price"}</span>
              </button>
            );
          })}
        </div></div>
      )}
      {open && compHits.length === 0 && bundleHits.length === 0 && <p className="muted">Nothing matches. Add components in the Catalog first.</p>}
    </div>
  );
}
