import Link from "next/link";
import { logout } from "../login/actions";

const NAV = [
  ["/quotes", "Quotes"],
  ["/catalog", "Catalog"],
  ["/bundles", "Bundles"],
  ["/sync", "Sync"],
  ["/settings", "Settings"],
] as const;

export const dynamic = "force-dynamic";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <header className="site-header">
        <div className="inner">
          <p className="brand-mark">Waste2Light · Green Corner</p>
          <nav aria-label="Main">
            {NAV.map(([href, label]) => (
              <Link key={href} href={href}>{label}</Link>
            ))}
          </nav>
          <Link className="btn primary" href="/quotes/new">New quote</Link>
          <form action={logout}><button className="btn small">Sign out</button></form>
        </div>
      </header>
      <main className="page">{children}</main>
    </>
  );
}
