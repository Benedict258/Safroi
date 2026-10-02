import { createBundle } from "../actions";

export const metadata = { title: "New bundle" };

export default async function NewBundle({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const sp = await searchParams;
  return (
    <>
      <h1>New bundle</h1>
      {sp.error && <p className="error" role="alert">Give the bundle a name.</p>}
      <form action={createBundle} className="stack card">
        <label>Name<input name="name" required maxLength={200} placeholder="e.g. Starter kit for one class" /></label>
        <label>Description<textarea name="description" rows={2} maxLength={1000} /></label>
        <div><button className="btn primary">Create and add components</button></div>
      </form>
    </>
  );
}
