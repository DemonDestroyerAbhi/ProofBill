import { NextResponse, type NextRequest } from "next/server";
import { appUrl, createDemoUser, demoEnabled, getUser, seedDemoWorkspace } from "@proofbill/services";
import { decodeSession, encodeSession, returnCookie, sessionCookie } from "@/lib/session";

/**
 * Demo switch ON: a fresh, private sample workspace for this visitor (seeded Larkspur contract).
 * If a real account is signed in, it's remembered so the switch can return to it.
 * Disable entirely with DEMO_MODE=off.
 */
export async function POST(req: NextRequest) {
  if (!demoEnabled()) return NextResponse.redirect(`${appUrl()}/?error=Demo+mode+is+disabled`, 303);
  const current = decodeSession(req.cookies.get(sessionCookie.name)?.value);
  const currentUser = current ? await getUser(current) : null;
  const res = NextResponse.redirect(`${appUrl()}/app`, 303);
  if (currentUser?.isDemo) return res; // already in a demo workspace
  const demo = await createDemoUser();
  await seedDemoWorkspace(demo.id);
  if (currentUser) res.cookies.set(returnCookie.name, encodeSession(currentUser.id), returnCookie.options);
  res.cookies.set(sessionCookie.name, encodeSession(demo.id), sessionCookie.options);
  return res;
}
