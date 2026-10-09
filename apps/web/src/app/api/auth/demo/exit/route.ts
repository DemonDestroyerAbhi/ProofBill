import { NextResponse, type NextRequest } from "next/server";
import { appUrl, getUser } from "@proofbill/services";
import { decodeSession, encodeSession, homeFor, returnCookie, sessionCookie } from "@/lib/session";

/** Demo switch OFF: back to the real account that turned it on, or signed out if there wasn't one. */
export async function POST(req: NextRequest) {
  const backId = decodeSession(req.cookies.get(returnCookie.name)?.value);
  const back = backId ? await getUser(backId) : null;
  const res = NextResponse.redirect(`${appUrl()}${back ? homeFor(back) : "/"}`, 303);
  res.cookies.delete(returnCookie.name);
  if (back && !back.isDemo) res.cookies.set(sessionCookie.name, encodeSession(back.id), sessionCookie.options);
  else res.cookies.delete(sessionCookie.name);
  return res;
}
