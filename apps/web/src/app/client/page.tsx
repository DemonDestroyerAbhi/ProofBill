import Link from "next/link";
import { clientDashboard } from "@proofbill/services";
import { requireClient } from "@/lib/session";
import { money } from "@/lib/format";
import { removePortalAction } from "../client-actions";

export default async function ClientHome() {
  const user = await requireClient();
  const rows = await clientDashboard(user.id);
  const waiting = rows.reduce((s, r) => s + r.awaitingReview, 0);
  return (
    <main className="container stack-lg">
      <div>
        <h1>Your freelancers</h1>
        <p className="muted" style={{ marginTop: 6 }}>Every evidence portal you&apos;ve saved, across all the freelancers you work with.</p>
      </div>
      {waiting > 0 && <div className="callout warn">{waiting} milestone{waiting > 1 ? "s" : ""} waiting for your review.</div>}
      {rows.length === 0 ? (
        <div className="card empty">
          <h2>No portals saved yet</h2>
          <p style={{ marginTop: 8, maxWidth: 520, marginInline: "auto" }}>
            When a freelancer shares a ProofBill evidence link with you, open it while signed in and choose
            <strong> Save to my account</strong>. It will show up here.
          </p>
        </div>
      ) : (
        <div className="grid-2">
          {rows.map((r) => (
            <div key={r.contractId} className="card card-pad stack-sm">
              <div className="row-between">
                <h2>{r.title}</h2>
                {r.awaitingReview > 0 && <span className="badge warn">{r.awaitingReview} to review</span>}
              </div>
              <div className="muted">with {r.freelancer}</div>
              <div className="progress" style={{ marginTop: 6 }}>
                <span style={{ width: `${r.milestones ? (r.accepted / r.milestones) * 100 : 0}%` }} />
              </div>
              <div className="row-between" style={{ fontSize: 13 }}>
                <span className="muted">{r.accepted}/{r.milestones} milestones accepted</span>
                <span>{r.openInvoices ? `${money(r.dueCents, r.currency)} due` : "Nothing due"}</span>
              </div>
              <div className="row" style={{ marginTop: 6 }}>
                <Link href={`/portal/${r.portalToken}`} className="btn sm primary">Open portal</Link>
                <form action={removePortalAction.bind(null, r.contractId)}>
                  <button className="btn sm ghost">Remove</button>
                </form>
              </div>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
