/**
 * Extraction eval: runs the live model on sample-sow.md and checks every field + its source clause.
 * Usage: ANTHROPIC_API_KEY=… pnpm --filter @proofbill/ai eval
 */
import { readFileSync } from "node:fs";
import { aiEnabled, extractTerms, mapEvidence } from "../src";

if (!aiEnabled()) {
  console.error("Set ANTHROPIC_API_KEY to run the eval against Claude.");
  process.exit(2);
}

const sow = readFileSync(new URL("../../../sample-sow.md", import.meta.url), "utf8");
const t0 = Date.now();
const { terms: t, by } = await extractTerms(sow, "sample-sow.md");
const checks: [string, unknown, unknown, boolean][] = [
  ["clientName", t.clientName.value, "Larkspur Labs Ltd.", !!t.clientName.source],
  ["clientEmail", t.clientEmail.value, "billing@larkspur.example", !!t.clientEmail.source],
  ["currency", t.currency.value, "USD", !!t.currency.source],
  ["rateType", t.rateType.value, "fixed", true],
  ["hourlyRate", t.hourlyRate.value, 40, !!t.hourlyRate.source],
  ["hourlyCapHours", t.hourlyCapHours.value, 20, !!t.hourlyCapHours.source],
  ["totalCap", t.totalCap.value, 3000, !!t.totalCap.source],
  ["netDays", t.netDays.value, 15, !!t.netDays.source],
  ["partialMinPct", t.partialMinPct.value, 25, !!t.partialMinPct.source],
  ["lateFeePctMonthly", t.lateFeePctMonthly.value, 1.5, !!t.lateFeePctMonthly.source],
  ["acceptanceWindowBizDays", t.acceptanceWindowBizDays.value, 5, !!t.acceptanceWindowBizDays.source],
  ["milestones.count", t.milestones.length, 3, true],
  ["milestones.amounts", t.milestones.map((m) => m.amount).join(","), "600,900,700", t.milestones.every((m) => !!m.source)],
  ["milestones.due", t.milestones.map((m) => m.dueDate).join(","), "2026-10-24,2026-11-07,2026-11-21", true],
  ["milestones.deps", JSON.stringify(t.milestones.map((m) => m.dependsOn)), "[[],[1],[2]]", true],
];
let fail = 0;
for (const [k, got, want, src] of checks) {
  const ok = got === want && src;
  if (!ok) fail++;
  console.log(`${ok ? "✔" : "✘"} ${k.padEnd(26)} got=${JSON.stringify(got)} want=${JSON.stringify(want)} source=${src ? "yes" : "MISSING"}`);
}
console.log(`extraction by ${by} in ${Date.now() - t0}ms`);

const ms = t.milestones.map((m, i) => ({ number: i + 1, title: m.title, acceptanceCriteria: m.acceptanceCriteria, status: "in_progress" }));
const cases: [string, string[], number | null][] = [
  ["Add password reset flow with email token", ["src/auth/reset.ts", "test/reset.test.ts"], 1],
  ["PDF export endpoint for invoices", ["src/api/export/pdf.ts"], 2],
  ["Admin filters on exports table", ["src/admin/ExportsTable.tsx"], 3],
  ["Bump eslint to v9", ["package.json", "pnpm-lock.yaml"], null],
];
for (const [title, files, want] of cases) {
  const r = await mapEvidence({ type: "github_pr", title, files }, ms);
  const ok = want === null ? r.milestoneNumber === null || r.confidence < 0.6 : r.milestoneNumber === want && r.confidence >= 0.6;
  if (!ok) fail++;
  console.log(`${ok ? "✔" : "✘"} map "${title}" → M${r.milestoneNumber ?? "-"} @${r.confidence.toFixed(2)} — ${r.rationale}`);
}
process.exit(fail ? 1 : 0);
