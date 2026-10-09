import Link from "next/link";
import { requireClient } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function ClientLayout({ children }: { children: React.ReactNode }) {
  const user = await requireClient();
  return (
    <div className="shell">
      <header className="topbar">
        <Link href="/client" className="brand">
          <span className="brand-mark">✓</span> ProofBill
        </Link>
        <span className="muted" style={{ fontSize: 14 }}>Client</span>
        <span className="spacer" />
        <form action="/api/auth/logout" method="post">
          <button className="btn sm">{user.name || user.email} · Sign out</button>
        </form>
      </header>
      {children}
    </div>
  );
}
