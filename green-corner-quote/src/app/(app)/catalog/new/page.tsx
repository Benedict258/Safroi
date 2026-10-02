import { createComponent } from "../actions";
import ComponentForm from "../ComponentForm";
import { loadCategories } from "@/lib/catalog";

export const metadata = { title: "New component" };

export default async function NewComponent() {
  const cats = await loadCategories();
  return (
    <>
      <h1>New component</h1>
      <p className="muted">Save it, then link a Microscale and/or Hub360 listing on the next screen.</p>
      <datalist id="cats">{cats.map((c) => <option key={c} value={c} />)}</datalist>
      <ComponentForm action={createComponent} submitLabel="Create and link suppliers" />
    </>
  );
}
