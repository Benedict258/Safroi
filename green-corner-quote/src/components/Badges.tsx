import { isStale, type ListingPrice } from "@/lib/pricing";

export function Badge({ kind, children }: { kind: "ok" | "warn" | "bad" | "neutral"; children: React.ReactNode }) {
  return <span className={`badge ${kind}`}>{children}</span>;
}

/** Visible text badges for a listing's state: stock, stale, held, error, not synced. */
export function ListingBadges({ l, now, staleAfterHours }: { l: ListingPrice & { lastError?: string | null }; now: Date; staleAfterHours: number }) {
  if (l.price === null) {
    return <Badge kind={l.status === "error" ? "bad" : "neutral"}>{l.status === "error" ? "Sync error" : "Not synced"}</Badge>;
  }
  return (
    <>
      {!l.inStock && <Badge kind="bad">Out of stock</Badge>}{" "}
      {isStale(l, now, staleAfterHours) && <Badge kind="warn">Stale</Badge>}{" "}
      {l.status === "held" && <Badge kind="warn">Price held</Badge>}{" "}
      {l.status === "error" && <Badge kind="bad">Sync error</Badge>}
    </>
  );
}
