import Link from "next/link";
import { redirect } from "next/navigation";
import { ActionForm, Submit } from "@/components/action-form";
import { AuthShell } from "@/components/auth-shell";
import { currentUser, githubOAuthConfigured, homeFor } from "@/lib/session";
import { signUpAction } from "../auth-actions";

export const dynamic = "force-dynamic";

export default async function SignUp({ searchParams }: { searchParams: Promise<{ role?: string; next?: string }> }) {
  const user = await currentUser();
  if (user && !user.isDemo) redirect(homeFor(user));
  const { role, next } = await searchParams;
  const isClient = role === "client" || !!next?.startsWith("/portal/");
  return (
    <AuthShell title="Create your account" sub="Freelancers invoice from ProofBill. Clients review evidence and pay — free.">
      <ActionForm action={signUpAction} className="stack">
        <fieldset className="stack-sm" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="field" style={{ marginBottom: 6 }}>I am a…</legend>
          <div className="row" style={{ gap: 8 }}>
            <label className="role-option">
              <input type="radio" name="role" value="freelancer" defaultChecked={!isClient} />
              <span><strong>Freelancer</strong><small>I send invoices</small></span>
            </label>
            <label className="role-option">
              <input type="radio" name="role" value="client" defaultChecked={isClient} />
              <span><strong>Client</strong><small>I review work and pay</small></span>
            </label>
          </div>
        </fieldset>
        <label className="field">
          Name
          <input name="name" autoComplete="name" required minLength={2} maxLength={80} />
        </label>
        <label className="field">
          Email
          <input name="email" type="email" autoComplete="email" required />
        </label>
        <label className="field">
          Password
          <input name="password" type="password" autoComplete="new-password" required minLength={8} />
        </label>
        {next && <input type="hidden" name="next" value={next} />}
        <Submit className="btn primary" pendingText="Creating account…">Create account</Submit>
      </ActionForm>
      {githubOAuthConfigured() && (
        <>
          <div className="row" style={{ gap: 10, margin: "16px 0" }}>
            <span className="divider" style={{ flex: 1 }} /><small>or</small><span className="divider" style={{ flex: 1 }} />
          </div>
          <a href="/api/auth/github" className="btn" style={{ width: "100%" }}>Continue with GitHub (freelancers)</a>
        </>
      )}
      <p className="muted" style={{ marginTop: 16, fontSize: 14 }}>
        Already have an account? <Link className="link" href={`/signin${next ? `?next=${encodeURIComponent(next)}` : ""}`}>Sign in</Link>
      </p>
    </AuthShell>
  );
}
