import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { appUrl } from "@proofbill/services";

export async function GET() {
  const id = process.env.GITHUB_OAUTH_CLIENT_ID;
  if (!id) return NextResponse.redirect(`${appUrl()}/?error=GitHub+login+is+not+configured`);
  const state = randomBytes(16).toString("hex");
  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", id);
  url.searchParams.set("redirect_uri", `${appUrl()}/api/auth/github/callback`);
  url.searchParams.set("scope", "read:user user:email");
  url.searchParams.set("state", state);
  const res = NextResponse.redirect(url);
  res.cookies.set("pb_oauth_state", state, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 600, path: "/" });
  return res;
}
