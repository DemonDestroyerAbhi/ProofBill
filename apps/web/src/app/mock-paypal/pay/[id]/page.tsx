import { notFound } from "next/navigation";
import { MockInvoicing, invoicing } from "@proofbill/services";
import { moneyToCents } from "@proofbill/paypal";
import { ActionForm, Submit } from "@/components/action-form";
import { Badge } from "@/components/ui";
import { mockPayAction } from "../../../actions";

export const dynamic = "force-dynamic";

/** Offline stand-in for PayPal's payer page. Exists only in PAYPAL_ENV=mock. */
export default async function MockPay({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const pp = invoicing();
  if (!(pp instanceof MockInvoicing)) notFound();
  const inv = await pp.getInvoice(id).catch(() => null);
  if (!inv) notFound();
  const due = moneyToCents(inv.due_amount) / 100;
  return (
    <div className="shell">
      <header className="topbar" style={{ background: "#003087", color: "#fff" }}>
        <strong>PayPal (offline simulator)</strong>
      </header>
      <main className="container narrow stack">
        <div className="callout warn">This is ProofBill's offline PayPal simulator. With sandbox credentials, clients pay on PayPal's real sandbox payer page.</div>
        <div className="card card-pad stack">
          <div className="row-between">
            <h1 className="mono" style={{ fontSize: 22 }}>{inv.detail.invoice_number}</h1>
            <Badge status={inv.status} />
          </div>
          <p className="muted-2" style={{ whiteSpace: "pre-wrap" }}>{inv.detail.note}</p>
          <dl className="kv">
            <dt>Total</dt><dd>{inv.amount?.value} {inv.amount?.currency_code}</dd>
            <dt>Paid</dt><dd>{inv.payments?.paid_amount?.value}</dd>
            <dt>Due</dt><dd>{inv.due_amount?.value}</dd>
            <dt>Due date</dt><dd>{inv.detail.payment_term?.due_date}</dd>
          </dl>
          {due <= 0 && inv.status === "PAID" && <div className="form-msg ok">Paid in full — thank you.</div>}
          {due > 0 && inv.status !== "CANCELLED" && (
            <ActionForm action={mockPayAction.bind(null, id)} className="row">
              <input type="number" name="amount" step="0.01" min="0.01" max={due} defaultValue={due} style={{ width: 160 }} />
              <Submit className="btn paypal" pendingText="Paying…">Pay</Submit>
            </ActionForm>
          )}
        </div>
      </main>
    </div>
  );
}
