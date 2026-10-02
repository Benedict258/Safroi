import { notFound } from "next/navigation";
import QuoteBuilder from "../QuoteBuilder";
import { loadBuilderCatalog } from "../builderData";
import { loadQuote } from "@/lib/quotes";

export const metadata = { title: "Edit quote" };

export default async function EditQuote({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();
  const q = await loadQuote(id);
  if (!q) notFound();
  const catalog = await loadBuilderCatalog();
  return (
    <QuoteBuilder
      catalog={catalog}
      initial={{
        id: q.id, name: q.name, notes: q.notes,
        lines: q.lines
          .filter((l) => l.componentId || l.bundleId)
          .map((l) => ({
            lineId: l.id, kind: l.componentId ? "component" : "bundle", refId: (l.componentId ?? l.bundleId) as number, name: l.name,
            quantity: l.quantity, supplierUsed: l.supplierUsed, unitPrice: l.unitPrice, markupPct: l.markupPct, warnings: l.warnings,
            detail: Array.isArray(l.detail) ? (l.detail as { name: string; quantity: number; unitPrice: number; lineTotal: number }[]) : null,
          })),
      }}
    />
  );
}
