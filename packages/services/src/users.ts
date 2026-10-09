import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { and, eq, getDb, isNotNull, lt, sql, users, type User } from "@proofbill/db";

const scryptAsync = promisify(scrypt) as (pw: string, salt: Buffer, keylen: number, opts: { N: number; r: number; p: number }) => Promise<Buffer>;
const SCRYPT = { N: 16384, r: 8, p: 1 };

export class AuthError extends Error {}

/** Password hash: scrypt$N$r$p$salt$hash (base64). */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, 32, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [alg, n, r, p, salt, hash] = stored.split("$");
  if (alg !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64");
  const key = await scryptAsync(password, Buffer.from(salt, "base64"), expected.length, { N: Number(n), r: Number(r), p: Number(p) });
  return key.length === expected.length && timingSafeEqual(key, expected);
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export async function signUpWithPassword(input: { email: string; password: string; name: string; role: "freelancer" | "client" }): Promise<User> {
  const email = input.email.trim().toLowerCase();
  const name = input.name.trim().slice(0, 80);
  if (!EMAIL_RE.test(email)) throw new AuthError("Enter a valid email address");
  if (input.password.length < 8) throw new AuthError("Password must be at least 8 characters");
  if (name.length < 2) throw new AuthError("Enter your name");
  const db = getDb();
  const [exists] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(sql`lower(${users.email}) = ${email}`, isNotNull(users.passwordHash)));
  if (exists) throw new AuthError("An account with this email already exists — sign in instead");
  const [u] = await db
    .insert(users)
    .values({ login: email.split("@")[0]!, name, email, passwordHash: await hashPassword(input.password), role: input.role })
    .onConflictDoNothing()
    .returning();
  if (!u) throw new AuthError("An account with this email already exists — sign in instead");
  return u;
}

export async function signInWithPassword(emailRaw: string, password: string): Promise<User> {
  const email = emailRaw.trim().toLowerCase();
  const [u] = await getDb()
    .select()
    .from(users)
    .where(and(sql`lower(${users.email}) = ${email}`, isNotNull(users.passwordHash)));
  // Same message for unknown email and wrong password.
  if (!u?.passwordHash || !(await verifyPassword(password, u.passwordHash))) throw new AuthError("Email or password is incorrect");
  return u;
}

export async function upsertGithubUser(gh: { id: number; login: string; name?: string | null; email?: string | null; avatar_url?: string | null }): Promise<User> {
  const db = getDb();
  const [u] = await db
    .insert(users)
    .values({ githubId: String(gh.id), login: gh.login, name: gh.name ?? null, email: gh.email ?? null, avatarUrl: gh.avatar_url ?? null })
    .onConflictDoUpdate({
      target: users.githubId,
      set: { login: gh.login, avatarUrl: gh.avatar_url ?? null },
    })
    .returning();
  return u!;
}

/** Demo mode: every visitor gets their own throwaway freelancer workspace (cleaned up after DEMO_TTL_DAYS). */
export async function createDemoUser(): Promise<User> {
  const tag = randomBytes(3).toString("hex");
  const [u] = await getDb()
    .insert(users)
    .values({ login: `demo-${tag}`, name: "Demo Freelancer", isDemo: true, role: "freelancer" })
    .returning();
  return u!;
}

export async function cleanupDemoUsers(now = new Date()): Promise<number> {
  const days = Number(process.env.DEMO_TTL_DAYS ?? 3);
  const cutoff = new Date(now.getTime() - days * 86_400_000);
  const gone = await getDb()
    .delete(users)
    .where(and(eq(users.isDemo, true), lt(users.createdAt, cutoff)))
    .returning({ id: users.id });
  return gone.length;
}

export function demoEnabled(): boolean {
  return process.env.DEMO_MODE !== "off";
}

export async function updateDisplayName(userId: string, name: string): Promise<void> {
  const clean = name.trim().slice(0, 80);
  if (clean.length < 2) throw new Error("Name must be at least 2 characters");
  await getDb().update(users).set({ name: clean }).where(eq(users.id, userId));
}

export async function getUser(id: string): Promise<User | null> {
  const [u] = await getDb().select().from(users).where(eq(users.id, id));
  return u ?? null;
}
