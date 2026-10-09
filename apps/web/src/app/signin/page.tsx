import Link from "next/link";
import { redirect } from "next/navigation";
import { ActionForm, Submit } from "@/components/action-form";
import { AuthShell } from "@/components/auth-shell";
import { currentUser, githubOAuthConfigured, homeFor } from "@/lib/session";
import { signInAction } from "../auth-actions";

export const dynamic = "force-dynamic";

export default async function SignIn({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const user = await currentUser();
  if (user && !user.isDemo) redirect(homeFor(user));
  const { next, error } = await searchParams;
  return (
    <AuthShell title="Sign in" sub="Freelancers and clients use the same sign-in.">
      {error && <div className="form-msg error" style={{ marginBottom: 12 }}>{error}</div>}
      <ActionForm action={signInAction} className="stack">
        <label className="field">
          Email
          <input name="email" type="email" autoComplete="email" required />
        </label>
        <label className="field">
          Password
          <input name="password" type="password" autoComplete="current-password" required />
        </label>
        {next && <input type="hidden" name="next" value={next} />}
        <Submit className="btn primary" pendingText="Signing in…">Sign in</Submit>
      </ActionForm>
      {githubOAuthConfigured() && (
        <>
          <div className="row" style={{ gap: 10, margin: "16px 0" }}>
            <span className="divider" style={{ flex: 1 }} /><small>or</small><span className="divider" style={{ flex: 1 }} />
          </div>
          <a href="/api/auth/github" className="btn" style={{ width: "100%" }}>Continue with GitHub</a>
        </>
      )}
      <p className="muted" style={{ marginTop: 16, fontSize: 14 }}>
        New here? <Link className="link" href={`/signup${next ? `?next=${encodeURIComponent(next)}` : ""}`}>Create an account</Link>
      </p>
    </AuthShell>
  );
}
