"use client";
import { useState, useTransition } from "react";
import { linkListing, unlinkListing, updateUnits } from "../actions";
import { formatNaira, type Supplier } from "@/lib/pricing";

interface Hit { ref: string; title: string; price: number | null; inStock: boolean | null }

export default function ListingLinker({ componentId, supplier, current }: { componentId: number; supplier: Supplier; current: { id: number; units: number } | null }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [units, setUnits] = useState(current?.units ?? 1);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pending, start] = useTransition();

  async function search() {
    setMsg(null);
    setBusy(true);
    try {
      const isUrl = /^https?:\/\//i.test(q.trim());
      const r = await fetch(`/api/search/${supplier}?q=${encodeURIComponent(q)}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Search failed");
      setHits(j.hits);
      if (j.hits.length === 0) setMsg(isUrl ? "No product found at that URL." : "No matches. Try another word, or paste the product URL.");
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function link(h: Hit) {
    setMsg(null);
    start(async () => {
      try {
        const r = await linkListing(componentId, supplier, h.ref, units, h.title);
        setMsg(r.message);
        setHits([]);
      } catch (e) {
        setMsg((e as Error).message);
      }
    });
  }

  return (
    <div className="stack">
      <div className="row">
        <label>Search or paste a product URL
          <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); search(); } }} placeholder={supplier === "hub360" ? "arduino uno, or https://hub360.cc/shop/...-18006" : "arduino uno, or https://www.microscale.net/products/..."} />
        </label>
        <label style={{ flex: "0 0 140px" }}>Units per listing
          <input type="number" min={1} value={units} onChange={(e) => setUnits(Number(e.target.value))} />
        </label>
        <button type="button" className="btn" onClick={search} disabled={busy || q.trim().length < 2}>{busy ? "Searching..." : "Search"}</button>
      </div>
      {hits.length > 0 && (
        <div className="table-wrap"><table><tbody>
          {hits.map((h) => (
            <tr key={h.ref}>
              <td>{h.title}<br /><span className="muted small">{h.ref}</span></td>
              <td className="num">{h.price !== null ? formatNaira(h.price) : "-"}</td>
              <td className="num"><button type="button" className="btn small primary" disabled={pending} onClick={() => link(h)}>{current ? "Re-link to this" : "Link"}</button></td>
            </tr>
          ))}
        </tbody></table></div>
      )}
      {current && (
        <div className="row">
          <button type="button" className="btn small" disabled={pending} onClick={() => start(async () => { await updateUnits(current.id, units); setMsg("Units saved."); })}>Save units</button>
          <button type="button" className="btn small" disabled={pending} onClick={() => start(async () => { const r = await fetch("/api/sync", { method: "POST", body: JSON.stringify({ supplier, componentId }) }); setMsg(r.ok ? "Sync started. See the Sync page." : "Could not start sync."); })}>Sync this item now</button>
          <button type="button" className="btn small danger" disabled={pending} onClick={() => { if (confirm("Unlink this supplier listing?")) start(async () => { await unlinkListing(current.id); setMsg("Unlinked."); }); }}>Unlink</button>
        </div>
      )}
      {pending && <p className="muted">Working...</p>}
      {msg && <p className="notice" role="status">{msg}</p>}
    </div>
  );
}
