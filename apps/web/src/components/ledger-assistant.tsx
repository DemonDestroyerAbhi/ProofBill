"use client";

import { useState } from "react";

const EXAMPLES = ["What's still unpaid on Larkspur?", "Which milestones are waiting on the client?", "What's the live PayPal status of my latest invoice?"];

/** Ask-the-ledger agent: Gemini with read-only tools over our DB and live PayPal Invoicing. */
export function LedgerAssistant({ enabled }: { enabled: boolean }) {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<{ answer: string; trace: { tool: string; ok: boolean }[] } | null>(null);
  const ask = async (question: string) => {
    setBusy(true);
    setRes(null);
    try {
      const r = await fetch("/api/ledger/ask", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question }) });
      setRes(await r.json());
    } catch (e) {
      setRes({ answer: `Error: ${(e as Error).message}`, trace: [] });
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="card card-pad stack-sm">
      <div className="row-between">
        <h2>Ask the ledger</h2>
        <small className="muted">{enabled ? "Gemini · read-only tools: receivables, milestones, live PayPal invoice" : "needs GEMINI_API_KEY"}</small>
      </div>
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          if (q.trim()) ask(q.trim());
        }}
      >
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. What's unpaid on Larkspur?" style={{ flex: 1, minWidth: 240 }} disabled={!enabled} />
        <button className="btn primary" disabled={busy || !enabled}>{busy ? "Thinking…" : "Ask"}</button>
      </form>
      <div className="row" style={{ gap: 6 }}>
        {EXAMPLES.map((x) => (
          <button key={x} type="button" className="chip" style={{ cursor: "pointer" }} disabled={!enabled || busy} onClick={() => { setQ(x); ask(x); }}>
            {x}
          </button>
        ))}
      </div>
      {res && (
        <div className="callout stack-sm">
          <div className="assistant-answer">{res.answer}</div>
          {res.trace.length > 0 && <small className="muted">Tools used: {res.trace.map((t) => `${t.tool}${t.ok ? "" : " (failed)"}`).join(", ")}</small>}
        </div>
      )}
    </section>
  );
}
