import Link from "next/link";
import { cookies } from "next/headers";
import { demoEnabled, paypalMode } from "@proofbill/services";
import { aiEnabled } from "@proofbill/ai";
import { requireFreelancer, returnCookie } from "@/lib/session";
import { DemoSwitch } from "@/components/demo-switch";
import { resetDemoAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireFreelancer();
  const mode = paypalMode();
  const hasRealAccount = !!(await cookies()).get(returnCookie.name);
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
          <Link href="/app/settings">Settings</Link>
        </nav>
        <span className="spacer" />
        <span className="chip" title="PayPal Invoicing environment">PayPal: {mode}</span>
        {!aiEnabled() && <span className="chip" title="Set GEMINI_API_KEY to enable Gemini">AI: offline</span>}
        {demoEnabled() && <DemoSwitch on={user.isDemo} />}
        {user.isDemo ? (
          !hasRealAccount && <Link href="/signup" className="btn sm primary">Create account</Link>
        ) : (
          <form action="/api/auth/logout" method="post">
            <button className="btn sm">{user.name || user.login} · Sign out</button>
          </form>
        )}
      </header>
      {user.isDemo && (
        <div className="demo-banner" role="status">
          You&apos;re in a private demo workspace with sample data — nothing here touches real accounts.
          <form action={resetDemoAction}>
            <button className="btn sm ghost">Reset sample data</button>
          </form>
        </div>
      )}
      {mode === "mock" && (
        <div className="callout warn" style={{ borderRadius: 0, textAlign: "center", fontSize: 13 }}>
          Offline PayPal simulator — set PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET to use the PayPal sandbox.
        </div>
      )}
      {children}
    </div>
  );
}
