"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Supplier } from "@/lib/pricing";

export default function SyncControls({ supplier, running }: { supplier: Supplier; running: boolean }) {
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(running ? "A sync is running. Refresh to see the result." : null);
  const [busy, setBusy] = useState(false);

  async function go() {
    setBusy(true);
    setMsg(null);
    const r = await fetch("/api/sync", { method: "POST", body: JSON.stringify({ supplier }) });
    const j = await r.json().catch(() => ({}));
    setMsg(r.ok ? "Sync started. Refresh in a minute." : j.error ?? "Could not start sync.");
    setBusy(false);
    router.refresh();
  }
  return (
    <div className="stack">
      <div className="row">
        <button className="btn primary" onClick={go} disabled={busy}>Sync now</button>
        <button className="btn" onClick={() => router.refresh()}>Refresh</button>
      </div>
      {msg && <p className="notice" role="status">{msg}</p>}
    </div>
  );
}
