import Link from "next/link";
import { currentUser, githubOAuthConfigured } from "@/lib/session";
import { paypalMode } from "@proofbill/services";
import { aiEnabled } from "@proofbill/ai";

export const dynamic = "force-dynamic";

export default async function Landing({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const user = await currentUser();
  const { error } = await searchParams;
  return (
    <div className="shell">
      <header className="topbar">
        <Link href="/" className="brand">
          <span className="brand-mark">✓</span> ProofBill
        </Link>
        <span className="spacer" />
        {user ? (
          <Link href="/app" className="btn primary sm">Open workspace</Link>
        ) : githubOAuthConfigured() ? (
          <a href="/api/auth/github" className="btn sm">Sign in with GitHub</a>
        ) : null}
      </header>
      <main className="container">
        {error && <div className="form-msg error">{error}</div>}
        <section className="hero">
          <div>
            <div className="eyebrow">Milestone-verified invoicing for freelancers</div>
            <h1 style={{ marginTop: 14 }}>Invoices that prove the work.</h1>
            <p className="lede">
              The contract says what's owed. The evidence proves it's done. PayPal collects — with the proof attached.
              ProofBill reads your SOW, matches merged PRs, files and links to each milestone, lets your client accept in an
              evidence portal, then sends a PayPal invoice computed straight from the contract.
            </p>
            <div className="row" style={{ marginTop: 28 }}>
              <form action="/api/auth/demo" method="post">
                <button className="btn primary lg">Try the demo workspace →</button>
              </form>
              {githubOAuthConfigured() && (
                <a href="/api/auth/github" className="btn lg">Sign in with GitHub</a>
              )}
            </div>
            <p className="muted" style={{ marginTop: 14, fontSize: 13 }}>
              ProofBill never holds your money. Clients pay you directly through PayPal; we just make sure the invoice proves the work.
            </p>
            <div className="row" style={{ marginTop: 14, gap: 8 }}>
              <span className="chip">PayPal Invoicing: {paypalMode()}</span>
              <span className="chip">AI: {aiEnabled() ? "Claude" : "offline heuristics"}</span>
            </div>
          </div>
          <div className="card mock-invoice">
            <div className="row-between">
              <strong>Invoice PB-LARK7Q-M1</strong>
              <span className="badge good">Accepted by client</span>
            </div>
            <p className="muted" style={{ marginTop: 4 }}>Larkspur Labs · Net 15 · partial payments from 25%</p>
            <div className="line" style={{ marginTop: 12 }}>
              <div>
                <strong>Milestone 1: Authentication module</strong>
                <div className="muted" style={{ fontSize: 13 }}>Signup, login and password reset with passing tests — PR #12, PR #15</div>
              </div>
              <strong className="num">$600.00</strong>
            </div>
            <ul className="criteria" style={{ marginTop: 14 }}>
              {["Email/password signup", "login", "password reset", "tests passing"].map((c) => (
                <li key={c}>
                  <span className="check on">✓</span> {c} <span className="chip" style={{ marginLeft: "auto" }}>PR evidence</span>
                </li>
              ))}
            </ul>
            <div className="source" style={{ marginTop: 14 }}>
              <b>§2 Milestones and fees</b> — “Authentication module … $600 … 24 Oct 2026”
            </div>
          </div>
        </section>
        <section className="steps">
          {[
            ["Contract → terms", "Upload a SOW. AI extracts milestones, fees, cap, Net-N, late fee and acceptance window — each with its source clause. You confirm."],
            ["Evidence → milestones", "Merged PRs, Figma links and files are mapped to milestones with confidence and rationale. You confirm each one."],
            ["Client accepts", "Your client reviews every acceptance criterion with its evidence and accepts or asks for changes. Silence past the window = accepted."],
            ["PayPal invoice", "Amount computed in code from the contract — never by the AI. AI writes the line descriptions. You approve; PayPal sends."],
            ["Collect", "Webhooks track partial and full payment. Overdue? A tone-matched reminder goes out via PayPal, and the late-fee clause applies."],
          ].map(([t, d]) => (
            <div key={t} className="card step">
              <h3>{t}</h3>
              <p className="muted-2" style={{ marginTop: 6, fontSize: 14 }}>{d}</p>
            </div>
          ))}
        </section>
      </main>
    </div>
  );
}
