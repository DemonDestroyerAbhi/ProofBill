import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { contractByPortalToken, loadContractBundle, freelancerDisplayName } from "@proofbill/services";
import { date, dateTime, money } from "@/lib/format";
import { ActionForm, Submit } from "@/components/action-form";
import { Badge, EvidenceIcon } from "@/components/ui";
import { clientDecisionAction } from "../../actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Evidence portal — ProofBill", robots: { index: false } };

/**
 * The client's view: each acceptance criterion with the evidence behind it, and accept / request changes.
 * Authorised by the unguessable portal token in the URL — no client account needed.
 */
export default async function Portal({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const c0 = await contractByPortalToken(token);
  if (!c0) notFound();
  const { contract: c, client, milestones, evidence, invoices } = await loadContractBundle(c0.id);
  const confirmed = evidence.filter((e) => e.status === "confirmed");
  const who = await freelancerDisplayName(c);
  const pending = milestones.filter((m) => m.status === "submitted");

  return (
    <div className="shell">
      <header className="topbar">
        <span className="brand"><span className="brand-mark">✓</span> ProofBill</span>
        <span className="muted" style={{ fontSize: 14 }}>Evidence portal</span>
      </header>
      <main className="container narrow stack-lg">
        <div className="stack-sm">
          <div className="eyebrow">For {client?.name}</div>
          <h1>{c.title}</h1>
          <p className="muted-2">
            {who} has linked the work for each milestone to its acceptance criteria. Review the evidence, then accept the
            milestone or send it back with notes. You have {c.acceptanceWindowBizDays} business days per submission; per the contract, no
            response counts as acceptance.
          </p>
          {pending.length > 0 && <div className="callout warn">{pending.length} milestone{pending.length > 1 ? "s" : ""} waiting for your review.</div>}
        </div>

        {milestones.map((m) => {
          const ev = confirmed.filter((e) => e.milestoneId === m.id);
          const inv = invoices.find((i) => i.milestoneId === m.id && i.kind === "milestone" && !["CANCELLED", "draft", "sending", "send_failed"].includes(i.status));
          return (
            <section key={m.id} className="card" id={`m${m.number}`}>
              <div className="card-head">
                <div className="row">
                  <span className="milestone-num">{m.number}</span>
                  <h2>{m.title}</h2>
                  <Badge status={m.status} label={m.status === "submitted" ? "Ready for your review" : undefined} />
                </div>
                <strong>{m.billing === "fixed" ? money(m.amountCents, c.currency) : "Hourly"}</strong>
              </div>
              <div className="card-body stack">
                {m.submissionNote && m.status === "submitted" && <div className="callout">“{m.submissionNote}”</div>}
                <div className="stack-sm">
                  <small className="muted">Acceptance criteria → evidence</small>
                  <ul className="criteria">
                    {m.acceptanceCriteria.map((cr) => {
                      const proof = ev.filter((e) => e.aiCriteria?.includes(cr));
                      return (
                        <li key={cr} style={{ flexDirection: "column", gap: 4 }}>
                          <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                            <span className={`check ${proof.length ? "on" : "off"}`}>{proof.length ? "✓" : ""}</span>
                            <strong style={{ fontWeight: 600 }}>{cr}</strong>
                          </div>
                          {proof.length > 0 && (
                            <div className="row" style={{ gap: 6, paddingLeft: 26 }}>
                              {proof.map((p) => (
                                <a key={p.id} href={p.url ?? "#"} target="_blank" rel="noreferrer" className="chip">{p.title.split(":")[0]}</a>
                              ))}
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
                {ev.length > 0 && (
                  <div>
                    <small className="muted">All evidence</small>
                    {ev.map((e) => (
                      <div key={e.id} className="evidence-item">
                        <EvidenceIcon type={e.type} />
                        <div className="stack-sm" style={{ gap: 2 }}>
                          <a className="link" href={e.type === "file" && e.url ? `${e.url}?t=${token}` : e.url ?? "#"} target="_blank" rel="noreferrer">{e.title}</a>
                          <small className="muted">{e.aiSummary ?? e.type.replace("_", " ")} · {dateTime(e.capturedAt)}</small>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {m.status === "submitted" && (
                  <div className="grid-2">
                    <ActionForm action={clientDecisionAction.bind(null, token, m.id)} className="stack-sm">
                      <input type="hidden" name="action" value="accept" />
                      <input name="name" placeholder="Your name (optional)" />
                      <Submit className="btn primary" pendingText="Accepting…">Accept milestone</Submit>
                      <small>Due {date(m.dueDate)} · auto-accepts {dateTime(m.acceptanceDeadline)}</small>
                    </ActionForm>
                    <ActionForm action={clientDecisionAction.bind(null, token, m.id)} className="stack-sm">
                      <input type="hidden" name="action" value="reject" />
                      <textarea name="reason" placeholder="What needs to change?" rows={2} required />
                      <Submit className="btn" pendingText="Sending…">Request changes</Submit>
                    </ActionForm>
                  </div>
                )}
                {m.status === "rejected" && <div className="callout bad">You requested changes: {m.rejectionReason}</div>}
                {["accepted", "invoiced", "paid"].includes(m.status) && (
                  <div className="callout good">
                    Accepted {m.acceptedBy === "auto" ? "automatically after the review window" : ""} {dateTime(m.acceptedAt)}
                    {inv && (
                      <>
                        {" "}· Invoice <span className="mono">{inv.number}</span> — <Badge status={inv.status} />
                        {inv.payerViewUrl && !["PAID", "MARKED_AS_PAID"].includes(inv.status) && (
                          <> · <a className="link" href={inv.payerViewUrl} target="_blank" rel="noreferrer">Pay with PayPal</a></>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
            </section>
          );
        })}
        <p className="muted" style={{ fontSize: 13, textAlign: "center" }}>
          Payments go directly to {who} through PayPal. ProofBill never holds funds.
        </p>
      </main>
    </div>
  );
}
