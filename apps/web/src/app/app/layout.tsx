import Link from "next/link";
import { requireUser } from "@/lib/session";
import { paypalMode } from "@proofbill/services";
import { aiEnabled } from "@proofbill/ai";
import { resetDemoAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const mode = paypalMode();
  return (
    <div className="shell">
      <header className="topbar">
        <Link href="/app" className="brand">
          <span className="brand-mark">✓</span> ProofBill
        </Link>
        <nav className="nav">
          <Link href="/app">Contracts</Link>
          <Link href="/app/ledger">Ledger</Link>
          <Link href="/app/contracts/new">New contract</Link>
        </nav>
        <span className="spacer" />
        <span className="chip" title="PayPal Invoicing environment">PayPal: {mode}</span>
        {!aiEnabled() && <span className="chip" title="Set ANTHROPIC_API_KEY to enable Claude">AI: offline</span>}
        {user.isDemo && (
          <form action={resetDemoAction}>
            <button className="btn sm ghost" title="Re-seed the demo workspace">Reset demo</button>
          </form>
        )}
        <form action="/api/auth/logout" method="post">
          <button className="btn sm">{user.login} · Sign out</button>
        </form>
      </header>
      {mode === "mock" && (
        <div className="callout warn" style={{ borderRadius: 0, textAlign: "center", fontSize: 13 }}>
          Offline PayPal simulator — set PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET to use the PayPal sandbox.
        </div>
      )}
      {children}
    </div>
  );
}
