import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { ExtractedTerms } from "@proofbill/core";
import { getContract, loadContractBundle, NotFoundError, portalUrl } from "@proofbill/services";
import type { Evidence, Milestone } from "@proofbill/db";
import { requireUser } from "@/lib/session";
import { date, dateTime, money } from "@/lib/format";
import { ActionForm, Submit } from "@/components/action-form";
import { ActorTag, Badge, Card, Confidence, EvidenceIcon, EvidenceLink, Source } from "@/components/ui";
import { Gantt } from "@/components/gantt";
import { CopyButton } from "@/components/copy-button";
import {
  addManualEvidenceAction,
  addRepoAction,
  addTimeAction,
  buildInvoiceAction,
  capProbeAction,
  deleteTimeAction,
  pollReposAction,
  reviewEvidenceAction,
  submitMilestoneAction,
} from "../../../actions";

export default async function ContractPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const c0 = await getContract(user.id, id).catch((e) => (e instanceof NotFoundError ? null : Promise.reject(e)));
  if (!c0) notFound();
  if (c0.status === "draft") redirect(`/app/contracts/${id}/review`);
  const b = await loadContractBundle(id);
  const { contract: c, client, milestones, evidence, repos, timeEntries, invoices, audit } = b;
  const extracted = c.extracted as ExtractedTerms | null;
  const portal = portalUrl(c.portalToken);
  const inbox = evidence.filter((e) => e.status === "proposed");
  const live = invoices.filter((i) => i.status !== "CANCELLED" && i.status !== "draft");
  const invoiced = live.filter((i) => i.kind === "milestone").reduce((s, i) => s + i.amountCents, 0);
  const paid = live.reduce((s, i) => s + i.paidCents, 0);
  const start = extracted?.effectiveDate.value ? new Date(`${extracted.effectiveDate.value}T00:00:00Z`) : c.createdAt;
  const reviewEv = reviewEvidenceAction.bind(null, c.id);

  return (
    <main className="container stack-lg">
      <div className="row-between" style={{ alignItems: "flex-start" }}>
        <div className="stack-sm">
          <div className="row">
            <h1>{c.title}</h1>
            <Badge status={c.status} />
          </div>
          <p className="muted">
            {client?.name} · {client?.email} · <span className="mono">{c.code}</span> · from <span className="mono">{c.sourceDocName}</span>
          </p>
          <div className="row" style={{ gap: 6 }}>
            <span className="chip">Net {c.netDays}</span>
            {c.totalCapCents != null && <span className="chip">Cap {money(c.totalCapCents, c.currency)}</span>}
            {c.hourlyRateCents != null && <span className="chip">{money(c.hourlyRateCents, c.currency)}/h{c.hourlyCapHours ? ` · max ${c.hourlyCapHours}h` : ""}</span>}
            {c.partialMinPct != null && <span className="chip">Partial ≥ {c.partialMinPct}%</span>}
            {c.lateFeePctMonthly != null && <span className="chip">Late fee {c.lateFeePctMonthly}%/mo</span>}
            <span className="chip">Acceptance {c.acceptanceWindowBizDays} business days</span>
          </div>
        </div>
        <div className="card card-pad stack-sm" style={{ minWidth: 280 }}>
          <small className="muted">Client evidence portal</small>
          <div className="row" style={{ gap: 8 }}>
            <a className="btn sm primary" href={portal} target="_blank" rel="noreferrer">Open portal ↗</a>
            <CopyButton text={portal} />
          </div>
          <small className="muted">Invoiced {money(invoiced, c.currency)} · paid {money(paid, c.currency)}</small>
        </div>
      </div>

      <Card title="Timeline" sub="dependencies, due dates, acceptance windows, invoice due">
        <Gantt milestones={milestones} invoices={invoices} start={start} />
      </Card>

      {inbox.length > 0 && (
        <Card title="Evidence inbox" sub={`${inbox.length} item${inbox.length === 1 ? "" : "s"} to review — AI proposes, you confirm`} id="inbox">
          <div>
            {inbox.map((e) => {
              const proposed = milestones.find((m) => m.id === e.milestoneId);
              return (
                <div key={e.id} className="evidence-item">
                  <EvidenceIcon type={e.type} />
                  <div className="stack-sm" style={{ flex: 1, gap: 4 }}>
                    <div className="row-between">
                      <EvidenceLink url={e.url} title={e.title} sample={Boolean((e.meta as { sample?: boolean } | null)?.sample)}><strong>{e.title}</strong></EvidenceLink>
                      <small>{dateTime(e.capturedAt)}</small>
                    </div>
                    {e.mappedAt ? (
                      <>
                        <div className="row" style={{ gap: 8 }}>
                          {proposed ? (
                            <span className="chip ai">AI proposes → M{proposed.number} {proposed.title}</span>
                          ) : (
                            <span className="badge warn">Needs manual mapping</span>
                          )}
                          <Confidence value={e.aiConfidence} />
                        </div>
                        {e.aiRationale && <small className="muted-2">{e.aiRationale}</small>}
                        {e.aiCriteria && e.aiCriteria.length > 0 && <small className="muted">Criteria: {e.aiCriteria.join(" · ")}</small>}
                      </>
                    ) : (
                      <small className="muted">Mapping queued…</small>
                    )}
                    <ActionForm action={reviewEv} className="row" showOk={false}>
                      <input type="hidden" name="evidenceId" value={e.id} />
                      <select name="milestoneId" defaultValue={proposed?.id ?? milestones[0]?.id} style={{ width: "auto", minWidth: 220 }}>
                        {milestones.map((m) => (
                          <option key={m.id} value={m.id}>M{m.number} {m.title}</option>
                        ))}
                      </select>
                      <Submit className="btn sm primary" name="action" value="confirm">Confirm</Submit>
                      <Submit className="btn sm danger" name="action" value="reject">Not evidence</Submit>
                    </ActionForm>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      <section className="stack">
        <h2>Milestones</h2>
        {milestones.map((m) => (
          <MilestoneCard
            key={m.id}
            m={m}
            contractId={c.id}
            currency={c.currency}
            hourlyRateCents={c.hourlyRateCents}
            evidence={evidence.filter((e) => e.milestoneId === m.id && e.status === "confirmed")}
            entries={timeEntries.filter((t) => t.milestoneId === m.id)}
            invoice={invoices.find((i) => i.milestoneId === m.id && i.kind === "milestone" && i.status !== "CANCELLED")}
            blockedBy={m.dependsOn.filter((n) => !["accepted", "invoiced", "paid"].includes(milestones.find((x) => x.number === n)?.status ?? ""))}
            source={m.source}
          />
        ))}
      </section>

      <div className="grid-2">
        <Card title="Evidence sources">
          <div className="stack">
            <div className="stack-sm">
              <h3>GitHub repositories</h3>
              {repos.length === 0 && <small>No repositories yet. Paste any public repo — merged PRs become evidence.</small>}
              {repos.map((r) => (
                <div key={r.id} className="row-between">
                  <a className="link mono" href={`https://github.com/${r.fullName}`} target="_blank" rel="noreferrer">{r.fullName}</a>
                  <small>{r.mode === "app" ? "webhooks" : "polling"} · {r.lastPolledAt ? `checked ${dateTime(r.lastPolledAt)}` : "not checked yet"}</small>
                </div>
              ))}
              <ActionForm action={addRepoAction.bind(null, c.id)} className="row">
                <input name="repo" placeholder="owner/repo or https://github.com/owner/repo" style={{ flex: 1, minWidth: 220 }} required />
                <Submit className="btn sm" pendingText="Connecting…">Connect</Submit>
              </ActionForm>
              {repos.length > 0 && (
                <ActionForm action={pollReposAction.bind(null, c.id)} className="row">
                  <Submit className="btn sm ghost" pendingText="Checking…">↻ Check for merged PRs now</Submit>
                </ActionForm>
              )}
            </div>
            <div className="divider" />
            <div className="stack-sm">
              <h3>Files & links</h3>
              <small>Figma frames, docs, screenshots, deployed URLs — evidence for non-code work.</small>
              <ActionForm action={addManualEvidenceAction.bind(null, c.id)} className="stack-sm">
                <input name="title" placeholder="Title, e.g. Figma: export dialog v2" />
                <div className="row">
                  <input name="url" placeholder="https://…" style={{ flex: 1, minWidth: 180 }} />
                  <small>or</small>
                  <input type="file" name="file" style={{ flex: 1, minWidth: 180 }} />
                </div>
                <div className="row">
                  <select name="milestoneId" defaultValue="" style={{ flex: 1 }}>
                    <option value="">Let AI propose a milestone</option>
                    {milestones.map((m) => (
                      <option key={m.id} value={m.id}>Attach to M{m.number} {m.title}</option>
                    ))}
                  </select>
                  <Submit className="btn sm" pendingText="Adding…">Add evidence</Submit>
                </div>
              </ActionForm>
            </div>
          </div>
        </Card>

        <Card title="Invoices" actions={<Link href="/app/ledger" className="btn sm ghost">Ledger →</Link>}>
          {invoices.length === 0 ? (
            <small>No invoices yet. Accepted milestones can be invoiced.</small>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr><th>Invoice</th><th>Status</th><th className="num">Amount</th><th className="num">Paid</th><th>Due</th></tr>
                </thead>
                <tbody>
                  {invoices.map((i) => (
                    <tr key={i.id}>
                      <td><Link className="link mono" href={`/app/invoices/${i.id}`}>{i.number}</Link>{i.kind === "late_fee" && <div><small>late fee</small></div>}</td>
                      <td><Badge status={i.status} /></td>
                      <td className="num">{money(i.amountCents, i.currency)}</td>
                      <td className="num">{money(i.paidCents, i.currency)}</td>
                      <td>{date(i.dueDate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="divider" style={{ margin: "16px 0" }} />
          <div className="stack-sm">
            <h3>Guardrails</h3>
            <small>Amounts come from confirmed terms only. Try to invoice past the contract cap:</small>
            <ActionForm action={capProbeAction.bind(null, c.id)} className="stack-sm">
              <Submit className="btn sm" pendingText="Checking…">Attempt an over-cap invoice</Submit>
            </ActionForm>
          </div>
        </Card>
      </div>

      <Card title="Audit log" sub="everything the AI proposed and every human decision">
        <div>
          {audit.map((a) => (
            <div key={a.id} className="audit-item">
              <ActorTag actor={a.actor} />
              <div className="stack-sm" style={{ gap: 2 }}>
                <div>{a.summary}</div>
                {a.rationale && <small className="muted-2">Why: {a.rationale}</small>}
                <small>{dateTime(a.at)} · {a.action}</small>
              </div>
            </div>
          ))}
        </div>
      </Card>

      {extracted && (
        <details className="card">
          <summary className="card-head"><h2>Contract terms & sources</h2><small className="muted">show</small></summary>
          <div className="card-body grid-3">
            {(["netDays", "totalCap", "hourlyRate", "hourlyCapHours", "partialMinPct", "lateFeePctMonthly", "acceptanceWindowBizDays"] as const).map((k) => (
              <div key={k}>
                <small className="muted">{k}</small>
                <div><strong>{String(extracted[k].value ?? "—")}</strong></div>
                <Source source={extracted[k].source} />
              </div>
            ))}
          </div>
        </details>
      )}
    </main>
  );
}

function MilestoneCard({
  m,
  contractId,
  currency,
  hourlyRateCents,
  evidence,
  entries,
  invoice,
  blockedBy,
  source,
}: {
  m: Milestone;
  contractId: string;
  currency: string;
  hourlyRateCents: number | null;
  evidence: Evidence[];
  entries: { id: string; date: string; hoursX100: number; note: string; invoiceId: string | null }[];
  invoice?: { id: string; number: string; status: string };
  blockedBy: number[];
  source: { section: string; quote: string } | null;
}) {
  const covered = new Set(evidence.flatMap((e) => e.aiCriteria ?? []));
  const hours = entries.reduce((s, e) => s + e.hoursX100, 0) / 100;
  const canSubmit = ["planned", "in_progress", "rejected"].includes(m.status);
  return (
    <div className="milestone">
      <div className="milestone-head">
        <span className="milestone-num">{m.number}</span>
        <div style={{ flex: 1 }} className="stack-sm">
          <div className="row-between">
            <div className="row">
              <h3 style={{ fontSize: 16 }}>{m.title}</h3>
              <Badge status={m.status} />
              {m.acceptedBy === "auto" && <span className="chip">auto-accepted</span>}
            </div>
            <div className="row" style={{ gap: 16 }}>
              <span className="muted">Due {date(m.dueDate)}</span>
              <strong>
                {m.billing === "fixed" ? money(m.amountCents, currency) : `${hours}h × ${money(hourlyRateCents, currency)}`}
              </strong>
            </div>
          </div>
          <div className="progress"><span style={{ width: `${m.progress}%` }} /></div>
        </div>
      </div>
      <div className="milestone-body">
        {m.status === "rejected" && m.rejectionReason && <div className="callout bad"><strong>Client requested changes:</strong> {m.rejectionReason}</div>}
        {m.status === "submitted" && (
          <div className="callout warn">
            Awaiting client review. Auto-accepts {dateTime(m.acceptanceDeadline)} if there's no response (contract acceptance clause).
          </div>
        )}
        <div className="grid-2">
          <div className="stack-sm">
            <small className="muted">Acceptance criteria</small>
            <ul className="criteria">
              {m.acceptanceCriteria.map((cr) => (
                <li key={cr}>
                  <span className={`check ${covered.has(cr) ? "on" : "off"}`}>{covered.has(cr) ? "✓" : ""}</span>
                  {cr}
                </li>
              ))}
            </ul>
            {source && <Source source={source} />}
          </div>
          <div className="stack-sm">
            <small className="muted">Confirmed evidence ({evidence.length})</small>
            {evidence.length === 0 && <small>None yet.</small>}
            {evidence.map((e) => (
              <div key={e.id} className="row" style={{ gap: 8, alignItems: "flex-start" }}>
                <EvidenceIcon type={e.type} />
                <div className="stack-sm" style={{ gap: 0 }}>
                  <EvidenceLink url={e.url} title={e.title} sample={Boolean((e.meta as { sample?: boolean } | null)?.sample)} />
                  {e.aiRationale && <small className="muted">{e.aiRationale}</small>}
                </div>
              </div>
            ))}
          </div>
        </div>

        {m.billing === "hourly" && (
          <div className="stack-sm">
            <small className="muted">Time entries (entered by you — hours are never inferred from commits)</small>
            {entries.length > 0 && (
              <table className="table">
                <tbody>
                  {entries.map((t) => (
                    <tr key={t.id}>
                      <td style={{ width: 120 }}>{date(t.date)}</td>
                      <td className="num" style={{ width: 70 }}>{t.hoursX100 / 100}h</td>
                      <td>{t.note}</td>
                      <td style={{ width: 90 }}>
                        {t.invoiceId ? <small>invoiced</small> : (
                          <form action={deleteTimeAction.bind(null, contractId, t.id)}><button className="btn sm ghost">Remove</button></form>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {canSubmit && (
              <ActionForm action={addTimeAction.bind(null, contractId, m.id)} className="row" showOk={false}>
                <input type="date" name="date" required style={{ width: 160 }} defaultValue={new Date().toISOString().slice(0, 10)} />
                <input type="number" name="hours" step="0.25" min="0.25" max="24" placeholder="Hours" required style={{ width: 100 }} />
                <input name="note" placeholder="What was done (approved change request…)" style={{ flex: 1, minWidth: 200 }} />
                <Submit className="btn sm">Log time</Submit>
              </ActionForm>
            )}
          </div>
        )}

        <div className="row">
          {canSubmit &&
            (blockedBy.length ? (
              <small className="muted">Can be submitted once Milestone {blockedBy.join(", ")} is accepted.</small>
            ) : (
              <ActionForm action={submitMilestoneAction.bind(null, contractId, m.id)} className="row" >
                <input name="note" placeholder="Note to client (optional)" style={{ minWidth: 280 }} />
                <Submit className="btn primary sm" pendingText="Submitting…">Mark complete → client review</Submit>
              </ActionForm>
            ))}
          {m.status === "accepted" && !invoice && (
            <ActionForm action={buildInvoiceAction.bind(null, m.id)} className="row">
              <Submit className="btn primary sm" pendingText="Building invoice…">Build invoice</Submit>
              <small>Amount computed from the contract; AI writes the line descriptions.</small>
            </ActionForm>
          )}
          {invoice && (
            <Link href={`/app/invoices/${invoice.id}`} className="btn sm">
              Invoice <span className="mono">{invoice.number}</span> · <Badge status={invoice.status} />
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
