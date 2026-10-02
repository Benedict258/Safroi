import type { ComponentRecord } from "@/lib/catalog";

export default function ComponentForm({ c, action, submitLabel }: { c?: Pick<ComponentRecord, "name" | "category" | "description" | "unitLabel" | "markupPct">; action: (f: FormData) => Promise<void>; submitLabel: string }) {
  return (
    <form action={action} className="stack card">
      <label>Name<input name="name" defaultValue={c?.name} required maxLength={200} /></label>
      <div className="row">
        <label>Category<input name="category" defaultValue={c?.category ?? "General"} list="cats" maxLength={80} /></label>
        <label>Unit label<input name="unit_label" defaultValue={c?.unitLabel ?? "pc"} maxLength={20} /></label>
        <label>Markup %<input name="markup_pct" type="number" step="0.01" min="0" max="1000" defaultValue={c?.markupPct ?? 10} required /></label>
      </div>
      <label>Description<textarea name="description" rows={2} defaultValue={c?.description} maxLength={1000} /></label>
      <div><button className="btn primary">{submitLabel}</button></div>
    </form>
  );
}
