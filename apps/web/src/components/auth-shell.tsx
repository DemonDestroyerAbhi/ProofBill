import Link from "next/link";
import type { ReactNode } from "react";

export function AuthShell({ title, sub, children }: { title: string; sub: string; children: ReactNode }) {
  return (
    <div className="shell">
      <header className="topbar">
        <Link href="/" className="brand">
          <span className="brand-mark">✓</span> ProofBill
        </Link>
      </header>
      <main className="container" style={{ maxWidth: 440 }}>
        <div className="stack" style={{ marginTop: 32 }}>
          <div>
            <h1 style={{ fontSize: 26 }}>{title}</h1>
            <p className="muted" style={{ marginTop: 6 }}>{sub}</p>
          </div>
          <div className="card card-pad">{children}</div>
        </div>
      </main>
    </div>
  );
}
