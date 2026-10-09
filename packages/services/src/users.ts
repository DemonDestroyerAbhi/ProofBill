import { eq, getDb, users, type User } from "@proofbill/db";

export async function upsertGithubUser(gh: { id: number; login: string; name?: string | null; email?: string | null; avatar_url?: string | null }): Promise<User> {
  const db = getDb();
  const [u] = await db
    .insert(users)
    .values({ githubId: String(gh.id), login: gh.login, name: gh.name ?? null, email: gh.email ?? null, avatarUrl: gh.avatar_url ?? null })
    .onConflictDoUpdate({
      target: users.githubId,
      set: { login: gh.login, name: gh.name ?? null, avatarUrl: gh.avatar_url ?? null },
    })
    .returning();
  return u!;
}

/** Judge mode: a shared demo freelancer. Login without GitHub OAuth. */
export async function getOrCreateDemoUser(): Promise<User> {
  const db = getDb();
  const [existing] = await db.select().from(users).where(eq(users.githubId, "demo"));
  if (existing) return existing;
  const [u] = await db
    .insert(users)
    .values({ githubId: "demo", login: "demo-freelancer", name: "Demo Freelancer", isDemo: true })
    .onConflictDoNothing()
    .returning();
  return u ?? (await db.select().from(users).where(eq(users.githubId, "demo")))[0]!;
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
