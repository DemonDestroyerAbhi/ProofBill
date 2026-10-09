import { NextResponse } from "next/server";
import { appUrl, getOrCreateDemoUser, listContracts, seedDemoWorkspace } from "@proofbill/services";
import { encodeSession, sessionCookie } from "@/lib/session";

/** Judge mode: one click into a seeded workspace. Disable with DEMO_MODE=off. */
export async function POST() {
  if (process.env.DEMO_MODE === "off") return NextResponse.redirect(`${appUrl()}/?error=Demo+mode+is+disabled`, 303);
  const user = await getOrCreateDemoUser();
  if ((await listContracts(user.id)).length === 0) await seedDemoWorkspace(user.id);
  const res = NextResponse.redirect(`${appUrl()}/app`, 303);
  res.cookies.set(sessionCookie.name, encodeSession(user.id), sessionCookie.options);
  return res;
}
