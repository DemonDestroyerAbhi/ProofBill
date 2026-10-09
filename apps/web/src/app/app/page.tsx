import Link from "next/link";
import { listContracts } from "@proofbill/services";
import { requireFreelancer } from "@/lib/session";
import { money } from "@/lib/format";
import { Badge } from "@/components/ui";

export default async function Dashboard() {
  const user = await requireFreelancer();
  const rows = await listContracts(user.id);
  const totals = rows.reduce(
    (a, r) => ({ invoiced: a.invoiced + r.invoicedCents, paid: a.paid + r.paidCents, waiting: a.waiting + r.awaitingClient }),
    { invoiced: 0, paid: 0, waiting: 0 },
  );
  return (
    <main className="container stack-lg">
      <div className="row-between">
        <div>
          <h1>Contracts</h1>
          <p className="muted">Every invoice traces back to a clause and a piece of evidence.</p>
        </div>
        <Link href="/app/contracts/new" className="btn primary">Upload a contract</Link>
      </div>
      <div className="grid-4">
        <div className="card stat"><div className="label">Contracts</div><div className="value">{rows.length}</div></div>
        <div className="card stat"><div className="label">Awaiting client</div><div className="value">{totals.waiting}</div></div>
        <div className="card stat"><div className="label">Invoiced</div><div className="value">{money(totals.invoiced)}</div></div>
        <div className="card stat"><div className="label">Outstanding</div><div className="value">{money(totals.invoiced - totals.paid)}</div></div>
      </div>
      {rows.length === 0 ? (
        <div className="card empty">
          <h2>No contracts yet</h2>
          <p style={{ marginTop: 8 }}>Upload a SOW, contract or email thread to get started.</p>
          <Link href="/app/contracts/new" className="btn primary" style={{ marginTop: 16 }}>Upload a contract</Link>
        </div>
      ) : (
        <div className="grid-2">
          {rows.map((r) => (
            <Link
              key={r.contract.id}
              href={r.contract.status === "draft" ? `/app/contracts/${r.contract.id}/review` : `/app/contracts/${r.contract.id}`}
              className="card card-pad stack-sm"
              style={{ textDecoration: "none" }}
            >
              <div className="row-between">
                <h2>{r.contract.title}</h2>
                <Badge status={r.contract.status} label={r.contract.status === "draft" ? "Review terms" : undefined} />
              </div>
              <div className="muted">{r.client?.name ?? "Client not confirmed"} · <span className="mono">{r.contract.code}</span></div>
              {r.contract.status !== "draft" && (
                <>
                  <div className="progress" style={{ marginTop: 8 }}>
                    <span style={{ width: `${r.milestones ? (r.accepted / r.milestones) * 100 : 0}%` }} />
                  </div>
                  <div className="row-between" style={{ fontSize: 13 }}>
                    <span className="muted">{r.accepted}/{r.milestones} milestones accepted{r.awaitingClient ? ` · ${r.awaitingClient} awaiting client` : ""}</span>
                    <span>{money(r.paidCents)} paid of {money(r.invoicedCents)}</span>
                  </div>
                </>
              )}
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
