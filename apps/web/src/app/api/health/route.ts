import { NextResponse } from "next/server";
import { getDb, sql } from "@proofbill/db";
import { paypalMode } from "@proofbill/services";
import { aiEnabled } from "@proofbill/ai";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await getDb().execute(sql`select 1`);
    return NextResponse.json({ ok: true, db: "up", paypal: paypalMode(), ai: aiEnabled() ? "gemini" : "heuristic" });
  } catch (e) {
    return NextResponse.json({ ok: false, db: "down", error: (e as Error).message }, { status: 503 });
  }
}
