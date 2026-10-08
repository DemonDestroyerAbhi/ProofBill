import { ledgerRows } from "@proofbill/services";
import { aiEnabled } from "@proofbill/ai";
import { requireUser } from "@/lib/session";
import { money } from "@/lib/format";
import { LedgerGrid } from "@/components/ledger-grid";
import { LedgerAssistant } from "@/components/ledger-assistant";

export default async function LedgerPage() {
  const user = await requireUser();
  const rows = await ledgerRows(user.id);
  const byInvoice = new Map(rows.map((r) => [r.invoiceId, r]));
  const invs = [...byInvoice.values()].filter((r) => r.status !== "CANCELLED" && r.status !== "draft");
  const outstanding = invs.reduce((s, r) => s + r.balance, 0);
  const overdue = invs.filter((r) => r.daysOverdue > 0 && r.balance > 0);
  return (
    <main className="container stack-lg" style={{ maxWidth: 1360 }}>
      <div>
        <h1>Receivables ledger</h1>
        <p className="muted">One row per invoice line. Expand a row to see the evidence behind it.</p>
      </div>
      <div className="grid-4">
        <div className="card stat"><div className="label">Invoices</div><div className="value">{invs.length}</div></div>
        <div className="card stat">
          <div className="label">Collected</div>
          <div className="value">{money(Math.round(invs.reduce((s, r) => s + r.paid, 0) * 100))}</div>
          <small>net after PayPal fees {money(Math.round(invs.reduce((s, r) => s + (r.net ?? 0), 0) * 100))}</small>
        </div>
        <div className="card stat"><div className="label">Outstanding</div><div className="value">{money(Math.round(outstanding * 100))}</div></div>
        <div className="card stat"><div className="label">Overdue</div><div className="value" style={{ color: overdue.length ? "var(--bad)" : undefined }}>{overdue.length}</div></div>
      </div>
      <LedgerAssistant enabled={aiEnabled()} />
      <div className="card" style={{ padding: 8 }}>
        <LedgerGrid rows={rows} licenseKey={process.env.AG_GRID_LICENSE_KEY ?? ""} />
      </div>
    </main>
  );
}
