import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ProofBill — invoices that prove the work",
  description: "Milestone-verified invoicing for freelancers. The contract says what's owed, the evidence proves it's done, PayPal collects.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
