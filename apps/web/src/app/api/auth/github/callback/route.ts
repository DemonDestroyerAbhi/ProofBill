import { NextResponse, type NextRequest } from "next/server";
import { appUrl, upsertGithubUser } from "@proofbill/services";
import { encodeSession, sessionCookie } from "@/lib/session";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const fail = (m: string) => NextResponse.redirect(`${appUrl()}/?error=${encodeURIComponent(m)}`);
  if (!code || !state || state !== req.cookies.get("pb_oauth_state")?.value) return fail("GitHub sign-in failed (state mismatch)");

  const tok = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: process.env.GITHUB_OAUTH_CLIENT_ID,
      client_secret: process.env.GITHUB_OAUTH_CLIENT_SECRET,
      code,
      redirect_uri: `${appUrl()}/api/auth/github/callback`,
    }),
  }).then((r) => r.json() as Promise<{ access_token?: string; error_description?: string }>);
  if (!tok.access_token) return fail(tok.error_description ?? "GitHub sign-in failed");

  const gh = await fetch("https://api.github.com/user", {
    headers: { Authorization: `Bearer ${tok.access_token}`, Accept: "application/vnd.github+json", "User-Agent": "ProofBill" },
  }).then((r) => r.json() as Promise<{ id: number; login: string; name: string | null; email: string | null; avatar_url: string }>);
  if (!gh?.id) return fail("Could not read your GitHub profile");

  const user = await upsertGithubUser(gh);
  const res = NextResponse.redirect(`${appUrl()}/app`);
  res.cookies.set(sessionCookie.name, encodeSession(user.id), sessionCookie.options);
  res.cookies.delete("pb_oauth_state");
  return res;
}
