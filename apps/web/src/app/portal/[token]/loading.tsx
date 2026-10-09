import { PortalSkeleton } from "@/components/skeletons";

export default function Loading() {
  return (
    <div className="shell">
      <header className="topbar">
        <span className="brand"><span className="brand-mark">✓</span> ProofBill</span>
        <span className="muted" style={{ fontSize: 14 }}>Evidence portal</span>
      </header>
      <PortalSkeleton />
    </div>
  );
}
