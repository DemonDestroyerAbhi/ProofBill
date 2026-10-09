import type { Invoice, Milestone } from "@proofbill/db";

/**
 * Milestone timeline (Gantt). Dependencies, due dates, acceptance windows and invoice due markers;
 * progress is driven by confirmed evidence. Plain SVG — the Bryntum Gantt fallback from the plan.
 */
export function Gantt({ milestones, invoices, start, now = new Date() }: { milestones: Milestone[]; invoices: Invoice[]; start: Date; now?: Date }) {
  const DAY = 86_400_000;
  const due = (m: Milestone) => (m.dueDate ? new Date(`${m.dueDate}T00:00:00Z`) : null);
  const bars = milestones.map((m) => {
    const depEnds = m.dependsOn.map((n) => milestones.find((x) => x.number === n)).map((x) => (x ? due(x) : null)).filter((d): d is Date => !!d);
    const s = depEnds.length ? new Date(Math.max(...depEnds.map((d) => d.getTime()))) : start;
    const e = due(m);
    return { m, s, e, open: !e };
  });
  const invDue = invoices.filter((i) => i.dueDate && i.kind === "milestone" && i.status !== "CANCELLED");
  const times = [
    start.getTime(),
    now.getTime(),
    ...bars.flatMap((b) => [b.s.getTime(), b.e?.getTime() ?? 0]),
    ...milestones.map((m) => m.acceptanceDeadline?.getTime() ?? 0),
    ...invDue.map((i) => new Date(`${i.dueDate}T00:00:00Z`).getTime()),
  ].filter(Boolean);
  const t0 = Math.min(...times) - 2 * DAY;
  const t1 = Math.max(...times) + 4 * DAY;
  const W = 980;
  const LABEL = 210;
  const ROW = 44;
  const TOP = 34;
  const H = TOP + bars.length * ROW + 12;
  const x = (t: number) => LABEL + ((t - t0) / (t1 - t0)) * (W - LABEL - 16);

  const ticks: Date[] = [];
  const d = new Date(t0);
  d.setUTCHours(0, 0, 0, 0);
  const step = (t1 - t0) / DAY > 70 ? 14 : 7;
  for (let t = d.getTime(); t < t1; t += step * DAY) ticks.push(new Date(t));

  return (
    <div className="gantt" role="img" aria-label="Milestone timeline">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%">
        {ticks.map((t) => (
          <g key={t.getTime()}>
            <line className="g-grid" x1={x(t.getTime())} x2={x(t.getTime())} y1={TOP - 8} y2={H} />
            <text x={x(t.getTime()) + 4} y={18}>
              {t.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}
            </text>
          </g>
        ))}
        {bars.map((b, i) => {
          const y = TOP + i * ROW;
          const xs = x(b.s.getTime());
          const xe = b.e ? x(b.e.getTime()) : W - 20;
          const w = Math.max(6, xe - xs);
          return (
            <g key={b.m.id}>
              <text className="g-label" x={8} y={y + 18}>
                {`M${b.m.number} ${b.m.title}`.slice(0, 28)}
              </text>
              <text x={8} y={y + 34} style={{ fontSize: 11 }}>
                {b.m.status.replace("_", " ")} · {b.m.progress}%
              </text>
              <rect className="g-track" x={xs} y={y + 10} width={w} height={18} rx={5} strokeDasharray={b.open ? "4 3" : undefined} stroke={b.open ? "var(--line-2)" : "none"} />
              <rect className="g-fill" x={xs} y={y + 10} width={(w * b.m.progress) / 100} height={18} rx={5} opacity={b.m.status === "paid" ? 1 : 0.85} />
              {b.m.submittedAt && b.m.acceptanceDeadline && b.m.status === "submitted" && (
                <rect className="g-window" x={x(b.m.submittedAt.getTime())} y={y + 6} width={Math.max(4, x(b.m.acceptanceDeadline.getTime()) - x(b.m.submittedAt.getTime()))} height={26} rx={4}>
                  <title>Acceptance window — auto-accepts {b.m.acceptanceDeadline.toISOString().slice(0, 10)}</title>
                </rect>
              )}
              {b.e && (
                <text x={xe + 6} y={y + 24} style={{ fontSize: 11 }}>
                  {b.e.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}
                </text>
              )}
              {b.m.dependsOn.map((n) => {
                const j = bars.findIndex((x) => x.m.number === n);
                if (j < 0) return null;
                const from = bars[j]!;
                const fx = from.e ? x(from.e.getTime()) : xs;
                const fy = TOP + j * ROW + 19;
                return <path key={n} className="g-dep" d={`M${fx},${fy} C${fx + 14},${fy} ${xs - 14},${y + 19} ${xs},${y + 19}`} markerEnd="url(#arrow)" />;
              })}
              {invDue
                .filter((inv) => inv.milestoneId === b.m.id)
                .map((inv) => {
                  const ix = x(new Date(`${inv.dueDate}T00:00:00Z`).getTime());
                  return (
                    <g key={inv.id}>
                      <path className="g-inv" d={`M${ix},${y + 4} l5,6 l-5,6 l-5,-6 z`} opacity={inv.status === "PAID" ? 0.45 : 1} />
                      <title>{`Invoice ${inv.number} due ${inv.dueDate} (${inv.status})`}</title>
                    </g>
                  );
                })}
            </g>
          );
        })}
        <line className="g-today" x1={x(now.getTime())} x2={x(now.getTime())} y1={TOP - 8} y2={H} />
        <text x={x(now.getTime()) + 4} y={30} style={{ fontSize: 11, fill: "var(--bad)" }}>
          today
        </text>
        <defs>
          <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
            <path d="M0,0 L10,5 L0,10 z" fill="var(--ink-3)" />
          </marker>
        </defs>
      </svg>
      <div className="row" style={{ gap: 16, fontSize: 12, marginTop: 6 }}>
        <span className="row" style={{ gap: 6 }}><span style={{ width: 14, height: 8, background: "var(--accent)", borderRadius: 3 }} /> progress (confirmed evidence)</span>
        <span className="row" style={{ gap: 6 }}><span style={{ width: 14, height: 8, background: "var(--warn)", opacity: 0.4, borderRadius: 3 }} /> client acceptance window</span>
        <span className="row" style={{ gap: 6 }}><span style={{ color: "var(--info)" }}>◆</span> invoice due</span>
        <span className="row" style={{ gap: 6 }}><span style={{ color: "var(--bad)" }}>┊</span> today</span>
      </div>
    </div>
  );
}
