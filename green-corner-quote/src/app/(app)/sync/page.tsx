import Link from "next/link";
import { query } from "@/lib/db";
import { formatLagos } from "@/lib/time";
import { formatNaira, SUPPLIER_LABEL, SUPPLIERS } from "@/lib/pricing";
import { Badge } from "@/components/Badges";
import SyncControls from "./SyncControls";
import { decideHeld } from "./actions";

export const metadata = { title: "Sync" };

const kindFor = (s: string) => (s === "success" ? "ok" : s === "running" || s === "skipped" ? "neutral" : s === "partial" ? "warn" : "bad");

export default async function SyncPage() {
  const [runs, held, problems, running] = await Promise.all([
    query("select * from sync_runs order by started_at desc limit 30"),
    query(
      `select h.*, l.supplier, l.component_id, c.name from held_changes h join supplier_listings l on l.id = h.listing_id
       join components c on c.id = l.component_id where h.decision = 'pending' order by h.detected_at`),
    query(
      `select l.id, l.supplier, l.component_id, l.supplier_ref, l.last_error, c.name from supplier_listings l join components c on c.id = l.component_id
       where l.status = 'error' order by c.name`),
    query("select supplier from sync_runs where status = 'running' and started_at > now() - interval '30 minutes'"),
  ]);
  const runningSet = new Set(running.map((r) => r.supplier));
  return (
    <>
      <h1>Sync</h1>

      <div className="card-grid" style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}>
        {SUPPLIERS.map((s) => {
          const last = runs.find((r) => r.supplier === s && !r.component_id && r.status !== "running");
          return (
            <section className="card" key={s}>
              <h2>{SUPPLIER_LABEL[s]}</h2>
              {last ? (
                <p>
                  <Badge kind={kindFor(last.status)}>{last.status}</Badge> {formatLagos(last.started_at)}<br />
                  <span className="muted small">{last.updated_count} updated · {last.unchanged_count} unchanged · {last.failed_count} failed</span>
                </p>
              ) : <p className="muted">No full run yet.</p>}
              <SyncControls supplier={s} running={runningSet.has(s)} />
            </section>
          );
        })}
      </div>

      <h2>Held price changes ({held.length})</h2>
      <p className="muted small">A change above the threshold does not replace the live price until you approve it.</p>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Component</th><th>Supplier</th><th className="num">Live price</th><th className="num">New price</th><th className="num">Change</th><th>Seen</th><th></th></tr></thead>
          <tbody>
            {held.length === 0 && <tr><td colSpan={7} className="muted">Nothing waiting for review.</td></tr>}
            {held.map((h) => {
              const pct = ((h.new_price_ngn - h.old_price_ngn) / h.old_price_ngn) * 100;
              return (
                <tr key={h.id}>
                  <td><Link href={`/catalog/${h.component_id}`}>{h.name}</Link></td>
                  <td>{SUPPLIER_LABEL[h.supplier as "microscale"]}</td>
                  <td className="num">{formatNaira(h.old_price_ngn)}</td>
                  <td className="num">{formatNaira(h.new_price_ngn)}</td>
                  <td className="num">{pct > 0 ? "+" : ""}{pct.toFixed(1)}%</td>
                  <td>{formatLagos(h.detected_at)}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <form action={decideHeld.bind(null, h.id, "approved")} style={{ display: "inline" }}><button className="btn small primary">Approve</button></form>{" "}
                    <form action={decideHeld.bind(null, h.id, "rejected")} style={{ display: "inline" }}><button className="btn small">Reject</button></form>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <h2>Broken listings ({problems.length})</h2>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Component</th><th>Supplier</th><th>Problem</th></tr></thead>
          <tbody>
            {problems.length === 0 && <tr><td colSpan={3} className="muted">All linked listings are syncing.</td></tr>}
            {problems.map((p) => (
              <tr key={p.id}>
                <td><Link href={`/catalog/${p.component_id}`}>{p.name}</Link> <span className="muted small">(re-link)</span></td>
                <td>{SUPPLIER_LABEL[p.supplier as "microscale"]}</td>
                <td>{p.last_error}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>Run history</h2>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Started</th><th>Supplier</th><th>Trigger</th><th>Status</th><th className="num">Updated</th><th className="num">Unchanged</th><th className="num">Failed</th><th>Log</th></tr></thead>
          <tbody>
            {runs.length === 0 && <tr><td colSpan={8} className="muted">No runs yet.</td></tr>}
            {runs.map((r) => (
              <tr key={r.id}>
                <td>{formatLagos(r.started_at)}</td>
                <td>{SUPPLIER_LABEL[r.supplier as "microscale"]}{r.component_id ? " (one item)" : ""}</td>
                <td>{r.trigger}</td>
                <td><Badge kind={kindFor(r.status)}>{r.status}</Badge></td>
                <td className="num">{r.updated_count}</td><td className="num">{r.unchanged_count}</td><td className="num">{r.failed_count}</td>
                <td>{r.log ? <details><summary>View</summary><pre className="small" style={{ whiteSpace: "pre-wrap", maxWidth: 520 }}>{r.log}</pre></details> : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
