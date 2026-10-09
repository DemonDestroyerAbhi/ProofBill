import { NextResponse, type NextRequest } from "next/server";
import { askLedger } from "@proofbill/ai";
import { assistantTools } from "@proofbill/services";
import { currentUser } from "@/lib/session";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { question } = (await req.json()) as { question?: string };
  if (!question || question.length > 500) return NextResponse.json({ answer: "Ask a short question.", trace: [] });
  try {
    const r = await askLedger(question, assistantTools(user.id));
    return NextResponse.json(r);
  } catch (e) {
    return NextResponse.json({ answer: `The assistant failed: ${(e as Error).message}`, trace: [] });
  }
}
