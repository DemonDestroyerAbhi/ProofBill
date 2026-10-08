"use client";

import { useState, useTransition } from "react";
import type { ConfirmedTerms, ExtractedTerms, SourceRef } from "@proofbill/core";
import { confirmTermsAction } from "@/app/actions";
import { Source } from "./ui";

type M = ConfirmedTerms["milestones"][number];

const dollars = (c: number | null) => (c == null ? "" : String(c / 100));
const cents = (s: string) => (s.trim() === "" ? null : Math.round(Number(s) * 100));
const numOrNull = (s: string) => (s.trim() === "" ? null : Number(s));

export function TermsReview({ contractId, extracted, initial, sourceText }: { contractId: string; extracted: ExtractedTerms; initial: ConfirmedTerms; sourceText: string }) {
  const [t, setT] = useState<ConfirmedTerms>(initial);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const set = <K extends keyof ConfirmedTerms>(k: K, v: ConfirmedTerms[K]) => setT((p) => ({ ...p, [k]: v }));
  const setM = (i: number, patch: Partial<M>) => setT((p) => ({ ...p, milestones: p.milestones.map((m, j) => (j === i ? { ...m, ...patch } : m)) }));
  const fixedTotal = t.milestones.reduce((s, m) => s + (m.billing === "fixed" ? m.amountCents ?? 0 : 0), 0);

  const field = (label: string, src: SourceRef | null | undefined, input: React.ReactNode, hint?: string) => (
    <div className="stack-sm" style={{ gap: 4 }}>
      <label className="field">
        {label}
        {input}
      </label>
      {hint && <small>{hint}</small>}
      <Source source={src} />
    </div>
  );

  const submit = () =>
    start(async () => {
      setErr(null);
      const r = await confirmTermsAction(contractId, t);
      if (r?.error) setErr(r.error);
    });

  return (
    <div className="stack-lg">
      <section className="card">
        <div className="card-head"><h2>Client & payment terms</h2></div>
        <div className="card-body grid-3">
          {field("Contract title", extracted.title.source, <input value={t.title} onChange={(e) => set("title", e.target.value)} />)}
          {field("Client name", extracted.clientName.source, <input value={t.clientName} onChange={(e) => set("clientName", e.target.value)} />)}
          {field(
            "Client billing email",
            extracted.clientEmail.source,
            <input type="email" value={t.clientEmail} onChange={(e) => set("clientEmail", e.target.value)} />,
            "PayPal sends the invoice here. For the sandbox demo, use your sandbox Personal account email.",
          )}
          {field("Currency", extracted.currency.source, <input value={t.currency} maxLength={3} onChange={(e) => set("currency", e.target.value.toUpperCase())} />)}
          {field(
            "Rate type",
            extracted.rateType.source,
            <select value={t.rateType} onChange={(e) => set("rateType", e.target.value as "fixed" | "hourly")}>
              <option value="fixed">Fixed-price milestones</option>
              <option value="hourly">Hourly</option>
            </select>,
          )}
          {field("Payment term (Net days)", extracted.netDays.source, <input type="number" min={0} value={t.netDays} onChange={(e) => set("netDays", Number(e.target.value))} />)}
          {field("Hourly rate", extracted.hourlyRate.source, <input type="number" min={0} step="0.01" value={dollars(t.hourlyRateCents)} onChange={(e) => set("hourlyRateCents", cents(e.target.value))} />)}
          {field("Hourly cap (hours)", extracted.hourlyCapHours.source, <input type="number" min={0} value={t.hourlyCapHours ?? ""} onChange={(e) => set("hourlyCapHours", numOrNull(e.target.value))} />)}
          {field(
            "Total contract cap",
            extracted.totalCap.source,
            <input type="number" min={0} step="0.01" value={dollars(t.totalCapCents)} onChange={(e) => set("totalCapCents", cents(e.target.value))} />,
            "Over-cap invoices are blocked.",
          )}
          {field(
            "Partial payment minimum (%)",
            extracted.partialMinPct.source,
            <input type="number" min={0} max={99} value={t.partialMinPct ?? ""} onChange={(e) => set("partialMinPct", numOrNull(e.target.value))} />,
            "Blank = invoices must be paid in full.",
          )}
          {field("Late fee (% per month)", extracted.lateFeePctMonthly.source, <input type="number" min={0} step="0.1" value={t.lateFeePctMonthly ?? ""} onChange={(e) => set("lateFeePctMonthly", numOrNull(e.target.value))} />)}
          {field(
            "Acceptance window (business days)",
            extracted.acceptanceWindowBizDays.source,
            <input type="number" min={1} value={t.acceptanceWindowBizDays} onChange={(e) => set("acceptanceWindowBizDays", Number(e.target.value))} />,
            "Silence past the window counts as acceptance.",
          )}
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <h2>Milestones</h2>
          <small className="muted">
            Fixed fees total {(fixedTotal / 100).toLocaleString("en-US", { style: "currency", currency: t.currency || "USD" })}
            {t.totalCapCents != null && ` of a ${(t.totalCapCents / 100).toLocaleString("en-US", { style: "currency", currency: t.currency || "USD" })} cap`}
          </small>
        </div>
        <div className="card-body stack">
          {t.milestones.map((m, i) => {
            const src = extracted.milestones.find((x) => x.title === initial.milestones[i]?.title)?.source;
            return (
              <div key={i} className="milestone" style={{ padding: 16 }}>
                <div className="grid-3" style={{ gridTemplateColumns: "2fr 1fr 1fr" }}>
                  <label className="field">
                    Milestone {i + 1}
                    <input value={m.title} onChange={(e) => setM(i, { title: e.target.value })} />
                  </label>
                  <label className="field">
                    Billing
                    <select value={m.billing} onChange={(e) => setM(i, { billing: e.target.value as "fixed" | "hourly" })}>
                      <option value="fixed">Fixed fee</option>
                      <option value="hourly">Hourly (time entries)</option>
                    </select>
                  </label>
                  {m.billing === "fixed" ? (
                    <label className="field">
                      Fee
                      <input type="number" min={0} step="0.01" value={dollars(m.amountCents)} onChange={(e) => setM(i, { amountCents: cents(e.target.value) })} />
                    </label>
                  ) : (
                    <div className="field">
                      Fee
                      <small style={{ paddingTop: 10 }}>Logged hours × hourly rate</small>
                    </div>
                  )}
                </div>
                <div className="grid-3" style={{ gridTemplateColumns: "2fr 1fr 1fr", marginTop: 12 }}>
                  <label className="field">
                    Acceptance criteria (one per line)
                    <textarea
                      rows={3}
                      value={m.acceptanceCriteria.join("\n")}
                      onChange={(e) => setM(i, { acceptanceCriteria: e.target.value.split("\n").map((s) => s.trimStart()).filter((s, j, a) => s || j < a.length - 1) })}
                    />
                  </label>
                  <label className="field">
                    Due date
                    <input type="date" value={m.dueDate ?? ""} onChange={(e) => setM(i, { dueDate: e.target.value || null })} />
                  </label>
                  <label className="field">
                    Depends on (milestone #)
                    <input
                      value={m.dependsOn.join(", ")}
                      placeholder="e.g. 1"
                      onChange={(e) => setM(i, { dependsOn: (e.target.value.match(/\d+/g) ?? []).map(Number) })}
                    />
                  </label>
                </div>
                <div className="row-between" style={{ marginTop: 8 }}>
                  {src !== undefined ? <Source source={src} /> : <span className="source">Added by you</span>}
                  <button type="button" className="btn sm ghost danger" onClick={() => setT((p) => ({ ...p, milestones: p.milestones.filter((_, j) => j !== i) }))}>
                    Remove
                  </button>
                </div>
              </div>
            );
          })}
          <div>
            <button
              type="button"
              className="btn sm"
              onClick={() => setT((p) => ({ ...p, milestones: [...p.milestones, { title: "", acceptanceCriteria: [], amountCents: null, dueDate: null, dependsOn: [], billing: "fixed" }] }))}
            >
              + Add milestone
            </button>
          </div>
        </div>
      </section>

      <details className="card">
        <summary className="card-head"><h2>Source document</h2><small className="muted">show</small></summary>
        <pre className="card-body mono" style={{ whiteSpace: "pre-wrap", margin: 0, fontSize: 13, maxHeight: 420, overflow: "auto" }}>{sourceText}</pre>
      </details>

      <div className="card card-pad row-between" style={{ position: "sticky", bottom: 16 }}>
        <div className="stack-sm" style={{ gap: 2 }}>
          <strong>Confirm these terms?</strong>
          <small>Invoice amounts will be computed from these values only.</small>
        </div>
        <div className="row">
          {err && <div className="form-msg error">{err}</div>}
          <button className="btn primary" disabled={pending} onClick={submit}>
            {pending ? "Saving…" : "Confirm terms"}
          </button>
        </div>
      </div>
    </div>
  );
}
