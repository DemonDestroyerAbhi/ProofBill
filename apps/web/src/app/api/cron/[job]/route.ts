import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { runCollections, workerTick } from "@proofbill/services";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Background jobs over HTTP — for hosting without a worker or cron service (e.g. Render's free web
 * service). Called on a schedule by .github/workflows/cron.yml with `Authorization: Bearer $CRON_SECRET`.
 *   tick        — poll public repos, AI evidence mapping, auto-accept past the acceptance window
 *   collections — sync open invoices, overdue reminders, late fees, payment reconciliation
 */
const JOBS = { tick: () => workerTick(), collections: () => runCollections() } as const;

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  const got = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!secret || !got) return false;
  const a = Buffer.from(secret);
  const b = Buffer.from(got);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ job: string }> }) {
  if (!process.env.CRON_SECRET) return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 503 });
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { job } = await params;
  const run = JOBS[job as keyof typeof JOBS];
  if (!run) return NextResponse.json({ error: "unknown job" }, { status: 404 });
  const started = Date.now();
  const result = await run();
  console.log(`cron ${job}`, JSON.stringify(result));
  return NextResponse.json({ job, ms: Date.now() - started, ...result });
}
