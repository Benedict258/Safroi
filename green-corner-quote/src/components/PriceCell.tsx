import { formatNaira, type ListingPrice } from "@/lib/pricing";
import { ListingBadges } from "./Badges";

export function PriceCell({ l, now, staleAfterHours }: { l?: (ListingPrice & { lastError?: string | null }) | null; now: Date; staleAfterHours: number }) {
  if (!l) return <span className="muted">Not linked</span>;
  return (
    <div className="price-cell">
      {l.price !== null ? <span className="num">{formatNaira(l.price)}</span> : null}
      {l.price !== null && l.unitsPerListing > 1 && <small>pack of {l.unitsPerListing} · {formatNaira(l.price / l.unitsPerListing)} each</small>}
      <ListingBadges l={l} now={now} staleAfterHours={staleAfterHours} />
    </div>
  );
}
