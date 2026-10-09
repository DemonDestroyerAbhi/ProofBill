import { after, NextResponse, type NextRequest } from "next/server";
import { getDb, webhookEvents } from "@proofbill/db";
import { handleGithubPullRequest, mapPendingEvidence, verifyGithubSignature } from "@proofbill/services";

/** GitHub App / repo webhook: merged PRs become evidence; AI mapping runs after the response. */
export async function POST(req: NextRequest) {
  const raw = await req.text();
  if (!verifyGithubSignature(raw, req.headers.get("x-hub-signature-256"), process.env.GITHUB_WEBHOOK_SECRET))
    return NextResponse.json({ error: "bad signature" }, { status: 401 });
  const delivery = req.headers.get("x-github-delivery") ?? crypto.randomUUID();
  const event = req.headers.get("x-github-event") ?? "unknown";
  const [fresh] = await getDb()
    .insert(webhookEvents)
    .values({ id: `github:${delivery}`, provider: "github", eventType: event, verified: true, payload: JSON.parse(raw), processedAt: new Date() })
    .onConflictDoNothing()
    .returning();
  if (!fresh) return NextResponse.json({ result: "duplicate" });
  if (event === "ping") return NextResponse.json({ result: "pong" });
  if (event !== "pull_request") return NextResponse.json({ result: "ignored" });
  const n = await handleGithubPullRequest(JSON.parse(raw));
  if (n > 0) after(() => mapPendingEvidence().then(() => undefined));
  return NextResponse.json({ result: "ok", evidence: n });
}
