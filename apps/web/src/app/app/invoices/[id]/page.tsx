import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq, evidence as evidenceT, getDb, inArray, invoiceLines, invoicePayments, invoices, milestones, auditEvents, desc, clients } from "@proofbill/db";
import { getContract, NotFoundError, paypalMode, portalUrl } from "@proofbill/services";
import { requireUser } from "@/lib/session";
import { date, dateTime, money } from "@/lib/format";
import { ActionForm, Submit } from "@/components/action-form";
import { ActorTag, Badge, Card, EvidenceIcon, EvidenceLink } from "@/components/ui";
import {
  cancelInvoiceAction,
  reconcileAction,
  discardDraftAction,
  duplicateProbeAction,
  refreshInvoiceAction,
  remindAction,
  saveDraftAction,
  sendInvoiceAction,
} from "../../../actions";

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const db = getDb();
  const [inv] = await db.select().from(invoices).where(eq(invoices.id, id));
  if (!inv) notFound();
  const c = await getContract(user.id, inv.contractId).catch((e) => (e instanceof NotFoundError ? null : Promise.reject(e)));
  if (!c) notFound();
  const [lines, [m], [client], log, payments] = await Promise.all([
    db.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, inv.id)).orderBy(asc(invoiceLines.position)),
    inv.milestoneId ? db.select().from(milestones).where(eq(milestones.id, inv.milestoneId)) : Promise.resolve([]),
    c.clientId ? db.select().from(clients).where(eq(clients.id, c.clientId)) : Promise.resolve([]),
    db.select().from(auditEvents).where(and(eq(auditEvents.entity, "invoice"), eq(auditEvents.entityId, inv.id))).orderBy(desc(auditEvents.at)),
    db.select().from(invoicePayments).where(eq(invoicePayments.invoiceId, inv.id)).orderBy(asc(invoicePayments.initiatedAt)),
  ]);
  const evIds = [...new Set(lines.flatMap((l) => l.evidenceIds))];
  const ev = evIds.length ? await db.select().from(evidenceT).where(inArray(evidenceT.id, evIds)) : [];
  const isDraft = inv.status === "draft" || inv.status === "send_failed";
  const open = ["SENT", "PARTIALLY_PAID", "UNPAID", "PAYMENT_PENDING"].includes(inv.status);

  return (
    <main className="container stack-lg">
      <div className="row-between" style={{ alignItems: "flex-start" }}>
        <div className="stack-sm">
          <Link href={`/app/contracts/${c.id}`} className="muted" style={{ textDecoration: "none" }}>← {c.title}</Link>
          <div className="row">
            <h1 className="mono" style={{ fontSize: 24 }}>{inv.number}</h1>
            <Badge status={inv.status} />
            {inv.kind === "late_fee" && <span className="chip">late fee</span>}
          </div>
          <p className="muted">
            To {client?.name} &lt;{client?.email}&gt; · {m ? `Milestone ${m.number}: ${m.title}` : ""}
            {m?.acceptedAt && ` · accepted ${m.acceptedBy === "auto" ? "automatically" : "by client"} ${dateTime(m.acceptedAt)}`}
          </p>
        </div>
        <div className="card stat" style={{ minWidth: 240 }}>
          <div className="label">Total</div>
          <div className="value">{money(inv.amountCents, inv.currency)}</div>
          {inv.paidCents > 0 && <small>Paid {money(inv.paidCents, inv.currency)} · due {money(inv.amountCents - inv.paidCents, inv.currency)}</small>}
          {inv.minimumPaymentCents != null && <div><small>Partial payments from {money(inv.minimumPaymentCents, inv.currency)}</small></div>}
        </div>
      </div>

      {isDraft && (
        <div className="callout info">
          <strong>Review before sending.</strong> Amounts are computed from the confirmed contract terms and can't be edited here.
          The descriptions were written {lines.some((l) => l.descriptionBy === "ai") ? "by AI from the confirmed evidence" : "from a template"} — edit freely.
        </div>
      )}

      <Card title="Line items" pad={false}>
        <ActionForm action={saveDraftAction.bind(null, inv.id)} className="stack">
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>Item</th><th className="num">Qty</th><th className="num">Unit</th><th className="num">Amount</th></tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.id}>
                    <td style={{ minWidth: 360 }}>
                      <strong>{l.name}</strong>
                      {isDraft ? (
                        <textarea name={`line:${l.id}`} defaultValue={l.description} rows={3} style={{ marginTop: 6 }} />
                      ) : (
                        <div className="muted-2" style={{ marginTop: 4 }}>{l.description}</div>
                      )}
                      <div className="row" style={{ gap: 6, marginTop: 6 }}>
                        <span className={`chip ${l.descriptionBy === "ai" ? "ai" : ""}`}>text: {l.descriptionBy === "ai" ? "AI" : l.descriptionBy}</span>
                        <span className="chip">amount: computed from contract</span>
                      </div>
                    </td>
                    <td className="num">{l.quantity}{l.unitOfMeasure === "HOURS" ? "h" : ""}</td>
                    <td className="num">{money(l.unitAmountCents, inv.currency)}</td>
                    <td className="num"><strong>{money(l.totalCents, inv.currency)}</strong></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="card-body stack-sm">
            <label className="field">
              Note to client
              {isDraft ? <textarea name="note" defaultValue={inv.note ?? ""} rows={3} /> : <div className="muted-2" style={{ fontWeight: 400 }}>{inv.note}</div>}
            </label>
            <small>PayPal invoice also links the client's evidence portal: <span className="mono">{portalUrl(c.portalToken)}</span></small>
            {isDraft && <div><Submit className="btn sm">Save text</Submit></div>}
          </div>
        </ActionForm>
      </Card>

      {ev.length > 0 && (
        <Card title="Evidence cited">
          {ev.map((e) => (
            <div key={e.id} className="evidence-item">
              <EvidenceIcon type={e.type} />
              <div className="stack-sm" style={{ gap: 2 }}>
                <EvidenceLink url={e.url} title={e.title} sample={Boolean((e.meta as { sample?: boolean } | null)?.sample)} />
                {e.aiSummary && <small className="muted">{e.aiSummary}</small>}
              </div>
            </div>
          ))}
        </Card>
      )}

      <div className="grid-2">
        <Card title="PayPal">
          <div className="stack">
            {isDraft ? (
              <>
                <p className="muted-2">
                  Approving creates the invoice on your PayPal account ({paypalMode()}) with a unique number and an idempotency key, and emails it to the client.
                  Your client pays you directly — ProofBill never holds funds.
                </p>
                <div className="row">
                  <ActionForm action={sendInvoiceAction.bind(null, inv.id)} className="row">
                    <Submit className="btn paypal" pendingText="Sending via PayPal…">Approve & send with PayPal</Submit>
                  </ActionForm>
                  {!inv.paypalInvoiceId && (
                    <form action={discardDraftAction.bind(null, inv.id, c.id)}>
                      <button className="btn ghost danger">Discard draft</button>
                    </form>
                  )}
                </div>
              </>
            ) : (
              <>
                <dl className="kv">
                  <dt>PayPal invoice</dt><dd className="mono">{inv.paypalInvoiceId ?? "—"}</dd>
                  <dt>Sent</dt><dd>{dateTime(inv.sentAt)}</dd>
                  <dt>Due</dt><dd>{date(inv.dueDate)}</dd>
                  <dt>Paid</dt><dd>{money(inv.paidCents, inv.currency)} of {money(inv.amountCents, inv.currency)}</dd>
                  <dt>Reminders</dt><dd>{inv.reminderCount}{inv.lastReminderAt ? ` · last ${dateTime(inv.lastReminderAt)}` : ""}</dd>
                </dl>
                <div className="row">
                  {inv.payerViewUrl && <a className="btn paypal sm" href={inv.payerViewUrl} target="_blank" rel="noreferrer">Payer link ↗</a>}
                  <ActionForm action={refreshInvoiceAction.bind(null, inv.id)} className="row"><Submit className="btn sm">↻ Refresh from PayPal</Submit></ActionForm>
                </div>
                {open && (
                  <ActionForm action={remindAction.bind(null, inv.id)} className="stack-sm">
                    <div><Submit className="btn sm" pendingText="Writing reminder…">Send reminder now</Submit></div>
                    <small>AI writes a tone-matched note (friendly → firm → final); PayPal delivers it.</small>
                  </ActionForm>
                )}
                {open && inv.paidCents === 0 && (
                  <ActionForm action={cancelInvoiceAction.bind(null, inv.id)} confirm="Cancel this invoice on PayPal?">
                    <div><Submit className="btn sm ghost danger">Cancel invoice</Submit></div>
                  </ActionForm>
                )}
              </>
            )}
          </div>
        </Card>
        <Card title="Guardrails">
          <div className="stack-sm">
            <small>Idempotency: unique invoice number + PayPal-Request-Id + one live invoice per milestone in the database.</small>
            {inv.paypalInvoiceId ? (
              <ActionForm action={duplicateProbeAction.bind(null, inv.id)} className="stack-sm">
                <div><Submit className="btn sm" pendingText="Probing PayPal…">Try to create a duplicate</Submit></div>
                <small>Sends PayPal's negative-testing header <code>DUPLICATE_INVOICE_ID</code>; expects a 422.</small>
              </ActionForm>
            ) : (
              <small className="muted">Available once the invoice is on PayPal.</small>
            )}
          </div>
        </Card>
      </div>

      {inv.paidCents > 0 && (
        <Card
          title="Payments received"
          sub="PayPal Transaction Search · PayPal Server SDK"
          actions={
            <ActionForm action={reconcileAction.bind(null, inv.id)} className="row">
              <Submit className="btn sm" pendingText="Searching PayPal…">↻ Reconcile with PayPal</Submit>
            </ActionForm>
          }
          pad={false}
        >
          {payments.length === 0 ? (
            <div className="card-body">
              <small>No matching PayPal transactions yet. Transaction Search can take up to 3 hours to list a new payment.</small>
            </div>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr><th>Transaction</th><th>Date</th><th>Status</th><th className="num">Gross</th><th className="num">PayPal fee</th><th className="num">Net received</th></tr>
                </thead>
                <tbody>
                  {payments.map((p) => (
                    <tr key={p.id}>
                      <td className="mono">{p.transactionId}</td>
                      <td>{dateTime(p.initiatedAt)}</td>
                      <td>{{ S: "Completed", P: "Pending", V: "Reversed", D: "Denied" }[p.status] ?? p.status}</td>
                      <td className="num">{money(p.grossCents, p.currency)}</td>
                      <td className="num">−{money(p.feeCents, p.currency)}</td>
                      <td className="num"><strong>{money(p.netCents, p.currency)}</strong></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {inv.reconcileStatus && (
            <div className="card-body">
              <div className={`callout ${inv.reconcileStatus === "matched" ? "good" : inv.reconcileStatus === "mismatch" ? "bad" : "warn"}`}>
                {inv.reconcileStatus === "matched" &&
                  `Reconciled: PayPal transactions account for all ${money(inv.paidCents, inv.currency)} paid. You received ${money(inv.netCents, inv.currency)} after ${money(inv.feeCents, inv.currency)} in PayPal fees.`}
                {inv.reconcileStatus === "pending" && "Waiting for Transaction Search to list the latest payment (up to 3 hours)."}
                {inv.reconcileStatus === "mismatch" && `PayPal Invoicing reports ${money(inv.paidCents, inv.currency)} paid, but completed transactions don't add up — check the PayPal dashboard.`}
                {inv.reconciledAt && <small style={{ display: "block", marginTop: 4 }}>Checked {dateTime(inv.reconciledAt)}</small>}
              </div>
            </div>
          )}
        </Card>
      )}

      <Card title="Invoice history">
        {log.map((a) => (
          <div key={a.id} className="audit-item">
            <ActorTag actor={a.actor} />
            <div className="stack-sm" style={{ gap: 2 }}>
              <div>{a.summary}</div>
              {a.rationale && <small className="muted-2">Why: {a.rationale}</small>}
              {a.action === "reminder_sent" && a.payload ? (
                <blockquote className="callout" style={{ margin: 0 }}>{(a.payload as { note?: string }).note}</blockquote>
              ) : null}
              <small>{dateTime(a.at)}</small>
            </div>
          </div>
        ))}
      </Card>
    </main>
  );
}
