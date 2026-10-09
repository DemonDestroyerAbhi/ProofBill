import { NextResponse } from "next/server";
import { appUrl } from "@proofbill/services";
import { returnCookie, sessionCookie } from "@/lib/session";

export async function POST() {
  const res = NextResponse.redirect(`${appUrl()}/`, 303);
  res.cookies.delete(sessionCookie.name);
  res.cookies.delete(returnCookie.name);
  return res;
}
