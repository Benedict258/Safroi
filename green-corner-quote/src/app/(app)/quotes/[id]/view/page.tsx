import { notFound } from "next/navigation";
import Link from "next/link";
import { loadQuote } from "@/lib/quotes";
import { formatNaira, SUPPLIER_LABEL } from "@/lib/pricing";
import { formatLagos } from "@/lib/time";
import { deleteQuoteAction, duplicateQuoteAction } from "../../actions";
import ConfirmButton from "@/components/ConfirmButton";
import PrintButton from "@/components/PrintButton";
import { Badge } from "@/components/Badges";

export const metadata = { title: "Quote" };

export default async function ViewQuote({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();
  const q = await loadQuote(id);
  if (!q) notFound();
  return (
    <>
      <div className="page-head no-print">
        <h1>{q.name}</h1>
        <div>
          <Link className="btn" href="/quotes">All quotes</Link>
          <Link className="btn" href={`/quotes/${q.id}`}>Edit</Link>
          <form action={duplicateQuoteAction.bind(null, q.id)}><button className="btn" title="Copies the lines and prices them at today's prices">Duplicate</button></form>
          <PrintButton />
          <form action={deleteQuoteAction.bind(null, q.id)}><ConfirmButton message="Delete this quote?">Delete</ConfirmButton></form>
        </div>
      </div>
      <section className="card">
        <p className="print-only brand-mark">Waste2Light · Green Corner</p>
        <h2 className="print-only">{q.name}</h2>
        <p className="muted">Prices frozen on {formatLagos(q.updatedAt)} (Lagos time). All amounts in naira.</p>
        {q.notes && <p>{q.notes}</p>}
        <div className="table-wrap">
          <table>
            <thead><tr><th>Item</th><th className="num">Qty</th><th className="num">Unit price</th><th className="num">Line total</th></tr></thead>
            <tbody>
              {q.lines.map((l) => (
                <tr key={l.id}>
                  <td>
                    <span className="line-name">{l.name}</span> {l.bundleId !== null && <Badge kind="neutral">Bundle</Badge>}
                    {l.supplierUsed && <small className="muted no-print"> · {SUPPLIER_LABEL[l.supplierUsed]} @ {formatNaira(l.supplierPrice ?? 0)} + {l.markupPct}%</small>}
                    {Array.isArray(l.detail) && (
                      <details open><summary className="no-print">Contents</summary>
                        <ul className="small">{(l.detail as { name: string; quantity: number }[]).map((d, i) => <li key={i}>{d.quantity} × {d.name}</li>)}</ul>
                      </details>
                    )}
                    {l.warnings.length > 0 && <ul className="warnings no-print">{l.warnings.map((w, i) => <li key={i}>{w.message}</li>)}</ul>}
                  </td>
                  <td className="num">{l.quantity}</td>
                  <td className="num">{formatNaira(l.unitPrice)}</td>
                  <td className="num">{formatNaira(l.lineTotal)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr><td colSpan={3}>Total</td><td className="num">{formatNaira(q.total)}</td></tr></tfoot>
          </table>
        </div>
      </section>
    </>
  );
}
