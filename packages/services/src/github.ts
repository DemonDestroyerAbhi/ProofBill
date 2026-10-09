import { createHmac, timingSafeEqual } from "node:crypto";

export interface MergedPr {
  number: number;
  title: string;
  body: string | null;
  url: string;
  mergedAt: string;
  author: string | null;
  labels: string[];
  files?: string[];
  additions?: number;
  deletions?: number;
}

const API = "https://api.github.com";

function headers(): Record<string, string> {
  const h: Record<string, string> = { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "ProofBill" };
  if (process.env.GITHUB_TOKEN) h.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  return h;
}

export function parseRepo(input: string): string | null {
  const s = input.trim().replace(/\.git$/, "").replace(/\/$/, "");
  const m = s.match(/(?:github\.com[/:])?([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/);
  return m ? `${m[1]}/${m[2]}` : null;
}

export async function repoExists(fullName: string): Promise<boolean> {
  const r = await fetch(`${API}/repos/${fullName}`, { headers: headers() });
  return r.ok;
}

/** REST polling for any public repo (judges paste one). Newest-updated closed PRs, merged only. */
export async function fetchMergedPrs(fullName: string, opts: { since?: Date | null; limit?: number } = {}): Promise<MergedPr[]> {
  const r = await fetch(`${API}/repos/${fullName}/pulls?state=closed&sort=updated&direction=desc&per_page=${opts.limit ?? 30}`, {
    headers: headers(),
  });
  if (!r.ok) throw new Error(`GitHub ${r.status} listing PRs for ${fullName}`);
  const prs = (await r.json()) as {
    number: number;
    title: string;
    body: string | null;
    html_url: string;
    merged_at: string | null;
    user: { login: string } | null;
    labels: { name: string }[];
  }[];
  return prs
    .filter((p) => p.merged_at && (!opts.since || new Date(p.merged_at) > opts.since))
    .map((p) => ({
      number: p.number,
      title: p.title,
      body: p.body,
      url: p.html_url,
      mergedAt: p.merged_at!,
      author: p.user?.login ?? null,
      labels: p.labels.map((l) => l.name),
    }));
}

export async function fetchPrFiles(fullName: string, n: number): Promise<{ files: string[]; additions: number; deletions: number }> {
  const r = await fetch(`${API}/repos/${fullName}/pulls/${n}/files?per_page=100`, { headers: headers() });
  if (!r.ok) return { files: [], additions: 0, deletions: 0 };
  const files = (await r.json()) as { filename: string; additions: number; deletions: number }[];
  return {
    files: files.map((f) => f.filename),
    additions: files.reduce((s, f) => s + f.additions, 0),
    deletions: files.reduce((s, f) => s + f.deletions, 0),
  };
}

/** GitHub App / repo webhook signature: X-Hub-Signature-256 = sha256=HMAC(secret, body). */
export function verifyGithubSignature(rawBody: string, signature: string | null, secret: string | undefined): boolean {
  if (!secret || !signature?.startsWith("sha256=")) return false;
  const expected = Buffer.from(`sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`);
  const got = Buffer.from(signature);
  return expected.length === got.length && timingSafeEqual(expected, got);
}
