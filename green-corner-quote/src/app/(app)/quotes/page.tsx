import Link from "next/link";
import { listQuotes } from "@/lib/quotes";
import { formatNaira } from "@/lib/pricing";
import { formatLagos } from "@/lib/time";

export const metadata = { title: "Quotes" };

export default async function QuotesPage() {
  const quotes = await listQuotes();
  return (
    <>
      <div className="page-head">
        <h1>Quotes</h1>
        <div><Link className="btn primary" href="/quotes/new">New quote</Link></div>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Name</th><th>Lines</th><th className="num">Total</th><th>Updated</th></tr></thead>
          <tbody>
            {quotes.length === 0 && <tr><td colSpan={4} className="muted">No quotes yet. Start one with New quote.</td></tr>}
            {quotes.map((q) => (
              <tr key={q.id}>
                <td><Link href={`/quotes/${q.id}/view`}>{q.name}</Link></td>
                <td>{q.lines}</td>
                <td className="num">{formatNaira(q.total)}</td>
                <td>{formatLagos(q.updatedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
