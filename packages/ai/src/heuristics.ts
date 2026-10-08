import type { ExtractedTerms, SourceRef } from "@proofbill/core";
import type { EvidenceInput, MappingMilestone, MappingOutput } from "./mapping";

/**
 * Deterministic fallbacks used when no GEMINI_API_KEY is configured (local dev, CI, judges running
 * without a key). They are labelled "heuristic" everywhere they surface. They handle well-structured
 * SOWs like sample-sow.md; anything messier needs the model.
 */

interface Line {
  text: string;
  section: string;
}

function lines(doc: string): Line[] {
  let section = "Preamble";
  const out: Line[] = [];
  for (const raw of doc.split(/\r?\n/)) {
    const h = raw.match(/^#{1,6}\s+(.*)$/);
    if (h) section = h[1]!.trim();
    out.push({ text: raw, section });
  }
  return out;
}

const clean = (s: string) =>
  s
    .replace(/\*\*/g, "")
    .replace(/^\s*\|\s*|\s*\|\s*$/g, "")
    .replace(/\s*\|\s*/g, " · ")
    .replace(/\s+/g, " ")
    .trim();

function find(ls: Line[], re: RegExp): { m: RegExpMatchArray; src: SourceRef } | null {
  for (const l of ls) {
    const m = l.text.match(re);
    if (m) return { m, src: { section: l.section, quote: clean(l.text).slice(0, 240) } };
  }
  return null;
}

function num(s: string | undefined): number | null {
  if (s == null) return null;
  const n = Number(s.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

export function toIsoDate(s: string): string | null {
  const t = s.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const d = new Date(`${t} 00:00:00 UTC`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

const nil = <T>(value: T) => ({ value, source: null });

export function heuristicExtract(doc: string): ExtractedTerms {
  const ls = lines(doc);

  const titleH = find(ls, /^#\s+(.+)$/);
  const title = titleH ? clean(titleH.m[1]!.replace(/^Statement of Work\s*[—–-]\s*/i, "")) : "Untitled contract";

  const client = find(ls, /Client:\**\s*(.+?)\s*\(([^)\s]+@[^)\s]+)\)/i);
  const currency = find(ls, /Currency:\**\s*([A-Z]{3})/);
  const eff = find(ls, /Effective date:\**\s*(.+)$/i);
  const hourly = find(ls, /\$\s?([\d,.]+)\s*(?:\/|per)\s*h(?:ou)?r/i);
  const capH = find(ls, /capped at\s*\**\s*(\d+)\s*hours/i);
  const cap = find(ls, /(?:not exceed|cap(?:ped)? at|maximum of)\s*\**\s*\$\s?([\d,]+(?:\.\d+)?)/i);
  const net = find(ls, /Net[\s-]?(\d+)/i);
  const partial = find(ls, /minimum (?:partial )?payment is\s*(\d+(?:\.\d+)?)\s*%/i);
  const late = find(ls, /late fee of\s*\**\s*(\d+(?:\.\d+)?)\s*%\s*per month/i);
  const accept = find(ls, /(\d+)\s*business days/i);

  // Milestone table: header row containing "Milestone" and a fee/amount column.
  const milestones: ExtractedTerms["milestones"] = [];
  const hi = ls.findIndex((l) => /^\s*\|/.test(l.text) && /milestone/i.test(l.text) && /(fee|amount|price)/i.test(l.text));
  let anyHourlyRows = false;
  if (hi >= 0) {
    const cells = (s: string) => s.trim().replace(/^\||\|$/g, "").split("|").map((c) => clean(c));
    const header = cells(ls[hi]!.text).map((h) => h.toLowerCase());
    const col = (re: RegExp) => header.findIndex((h) => re.test(h));
    const cTitle = col(/milestone/);
    const cCrit = col(/criteria|deliverable/);
    const cFee = col(/fee|amount|price/);
    const cDue = col(/due|date/);
    for (let i = hi + 2; i < ls.length && /^\s*\|/.test(ls[i]!.text); i++) {
      const row = cells(ls[i]!.text);
      let crit = cCrit >= 0 ? row[cCrit] ?? "" : "";
      const deps = [...crit.matchAll(/depends on milestones?\s*([\d,\sand]+)/gi)].flatMap((m) =>
        (m[1]!.match(/\d+/g) ?? []).map(Number),
      );
      crit = crit.replace(/;?\s*depends on milestones?\s*[\d,\sand]+/gi, "");
      const fee = cFee >= 0 ? row[cFee]?.match(/[\d,]+(?:\.\d+)?/)?.[0] : undefined;
      if (cFee >= 0 && /hour|\/h/i.test(row[cFee] ?? "")) anyHourlyRows = true;
      milestones.push({
        title: row[cTitle] ?? `Milestone ${milestones.length + 1}`,
        acceptanceCriteria: crit
          .split(/[;,]/)
          .map((c) => c.trim())
          .filter(Boolean),
        amount: num(fee),
        dueDate: cDue >= 0 && row[cDue] ? toIsoDate(row[cDue]!) : null,
        dependsOn: deps,
        source: { section: ls[i]!.section, quote: clean(ls[i]!.text).slice(0, 240) },
      });
    }
  }

  const f = <T>(hit: { src: SourceRef } | null, value: T) => (hit ? { value, source: hit.src } : nil(value));
  return {
    title: f(titleH, title),
    clientName: f(client, client ? clean(client.m[1]!) : null),
    clientEmail: f(client, client ? client.m[2]! : null),
    currency: currency ? f(currency, currency.m[1]!) : nil("USD"),
    effectiveDate: f(eff, eff ? toIsoDate(clean(eff.m[1]!)) : null),
    rateType: milestones.length && !anyHourlyRows ? { value: "fixed", source: milestones[0]!.source } : nil(hourly ? "hourly" : "fixed"),
    hourlyRate: f(hourly, num(hourly?.m[1])),
    hourlyCapHours: f(capH, num(capH?.m[1])),
    totalCap: f(cap, num(cap?.m[1])),
    netDays: f(net, num(net?.m[1])),
    partialMinPct: f(partial, num(partial?.m[1])),
    lateFeePctMonthly: f(late, num(late?.m[1])),
    acceptanceWindowBizDays: f(accept, num(accept?.m[1])),
    milestones,
  } as ExtractedTerms;
}

const STOP = new Set(
  "the a an and or of for to in on with by from is are be this that it as at via add adds added fix fixes update updates use new into".split(" "),
);

function tokens(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 2 && !STOP.has(w))
      .map((w) => w.replace(/(ing|ed|es|s)$/, "")),
  );
}

export function heuristicMap(ev: EvidenceInput, milestones: MappingMilestone[]): MappingOutput {
  const text = [ev.title, ev.body ?? "", ...(ev.files ?? []), ...(ev.labels ?? [])].join(" ");
  const explicit = text.match(/\b(?:milestone|ms|m)\s*#?\s*(\d+)\b/i);
  if (explicit) {
    const n = Number(explicit[1]);
    const m = milestones.find((x) => x.number === n);
    if (m)
      return {
        milestoneNumber: n,
        confidence: 0.9,
        criteriaMatched: m.acceptanceCriteria.filter((c) => overlap(tokens(c), tokens(text)) > 0),
        rationale: `Evidence explicitly references Milestone ${n} ("${explicit[0]}").`,
        summary: ev.title,
      };
  }
  const evTok = tokens(text);
  let best: { m: MappingMilestone; score: number; crit: string[] } | null = null;
  for (const m of milestones) {
    const mTok = tokens([m.title, ...m.acceptanceCriteria].join(" "));
    const score = overlap(mTok, evTok) / Math.max(3, Math.min(mTok.size, 8));
    const crit = m.acceptanceCriteria.filter((c) => overlap(tokens(c), evTok) > 0);
    if (!best || score > best.score) best = { m, score, crit };
  }
  if (!best || best.score === 0)
    return { milestoneNumber: null, confidence: 0.1, criteriaMatched: [], rationale: "No keyword overlap with any milestone.", summary: ev.title };
  const confidence = Math.round(Math.min(0.85, 0.3 + best.score) * 100) / 100;
  return {
    milestoneNumber: best.m.number,
    confidence,
    criteriaMatched: best.crit,
    rationale: `Keyword overlap with Milestone ${best.m.number} "${best.m.title}"${best.crit.length ? ` (criteria: ${best.crit.join("; ")})` : ""}.`,
    summary: ev.title,
  };
}

function overlap(a: Set<string>, b: Set<string>): number {
  let n = 0;
  for (const x of a) if (b.has(x)) n++;
  return n;
}
