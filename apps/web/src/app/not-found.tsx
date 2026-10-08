import Link from "next/link";

export default function NotFound() {
  return (
    <main className="container narrow empty">
      <h1>Not found</h1>
      <p style={{ marginTop: 8 }}>That page doesn't exist, or you don't have access to it.</p>
      <Link href="/" className="btn" style={{ marginTop: 16 }}>Home</Link>
    </main>
  );
}
