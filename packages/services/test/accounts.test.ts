import { afterAll, describe, expect, it } from "vitest";
import { closeDb, contracts, eq, getDb, users, clients } from "@proofbill/db";
import {
  AuthError,
  cleanupDemoUsers,
  clientDashboard,
  confirmContract,
  createDemoUser,
  createDraftFromText,
  extractedToConfirmed,
  isPortalLinked,
  linkPortalToClient,
  SAMPLE_SOW,
  seedDemoWorkspace,
  signInWithPassword,
  signUpWithPassword,
  unlinkPortal,
} from "../src";

afterAll(closeDb);

describe("email + password accounts", () => {
  it("signs up, rejects duplicates case-insensitively, signs in", async () => {
    const u = await signUpWithPassword({ email: "Asha@Example.com", password: "correct horse", name: "Asha Rao", role: "freelancer" });
    expect(u).toMatchObject({ email: "asha@example.com", role: "freelancer", name: "Asha Rao" });
    expect(u.passwordHash).toMatch(/^scrypt\$/);
    await expect(signUpWithPassword({ email: "asha@EXAMPLE.com", password: "another pass", name: "X Y", role: "client" })).rejects.toThrow(/already exists/);
    expect((await signInWithPassword(" ASHA@example.com ", "correct horse")).id).toBe(u.id);
  });

  it("gives one message for wrong password and unknown email", async () => {
    await expect(signInWithPassword("asha@example.com", "wrong")).rejects.toThrow("Email or password is incorrect");
    await expect(signInWithPassword("nobody@example.com", "whatever")).rejects.toThrow("Email or password is incorrect");
  });

  it("validates input", async () => {
    await expect(signUpWithPassword({ email: "nope", password: "12345678", name: "A B", role: "client" })).rejects.toBeInstanceOf(AuthError);
    await expect(signUpWithPassword({ email: "a@b.co", password: "short", name: "A B", role: "client" })).rejects.toThrow(/8 characters/);
  });
});

describe("clients across freelancers", () => {
  it("one client account sees portals from two freelancers, linked only by opening each link", async () => {
    const client = await signUpWithPassword({ email: "ops@larkspur.example", password: "client-pass-1", name: "Priya", role: "client" });
    const f1 = await createDemoUser();
    const f2 = await signUpWithPassword({ email: "dev2@example.com", password: "freelancer-2", name: "Ravi", role: "freelancer" });
    const c1 = await seedDemoWorkspace(f1.id, { clientEmail: "ops@larkspur.example" });
    const d2 = await createDraftFromText(f2.id, { name: "sow.md", text: SAMPLE_SOW });
    const t2 = extractedToConfirmed(d2.extracted as never);
    t2.clientEmail = "ops@larkspur.example";
    await confirmContract(f2.id, d2.id, t2);

    expect(await clientDashboard(client.id)).toEqual([]); // same email is not enough
    const [k1] = await getDb().select().from(contracts).where(eq(contracts.id, c1));
    const [k2] = await getDb().select().from(contracts).where(eq(contracts.id, d2.id));
    await linkPortalToClient(client.id, k1!.portalToken);
    await linkPortalToClient(client.id, k2!.portalToken);
    await linkPortalToClient(client.id, k2!.portalToken); // idempotent
    const dash = await clientDashboard(client.id);
    expect(dash.map((d) => d.freelancer).sort()).toEqual(["Demo Freelancer", "Ravi"]);
    expect(await isPortalLinked(client.id, k1!.portalToken)).toBe(true);
    await unlinkPortal(client.id, c1);
    expect(await clientDashboard(client.id)).toHaveLength(1);

    // freelancers can't save portals; unknown tokens are rejected
    await expect(linkPortalToClient(f2.id, k1!.portalToken)).rejects.toThrow(/client accounts/);
    await expect(linkPortalToClient(client.id, "not-a-token")).rejects.toThrow(/not found/);
  });

  it("a freelancer's repeat client reuses one client record", async () => {
    const f = await signUpWithPassword({ email: "solo@example.com", password: "freelancer-3", name: "Solo", role: "freelancer" });
    for (let i = 0; i < 2; i++) {
      const d = await createDraftFromText(f.id, { name: `sow${i}.md`, text: SAMPLE_SOW });
      const t = extractedToConfirmed(d.extracted as never);
      t.clientEmail = i ? "Billing@Larkspur.example" : "billing@larkspur.example";
      await confirmContract(f.id, d.id, t);
    }
    expect(await getDb().select().from(clients).where(eq(clients.userId, f.id))).toHaveLength(1);
  });
});

describe("demo workspaces", () => {
  it("each visitor gets their own, and old ones are cleaned up", async () => {
    const a = await createDemoUser();
    const b = await createDemoUser();
    expect(a.id).not.toBe(b.id);
    await seedDemoWorkspace(a.id);
    const removed = await cleanupDemoUsers(new Date(Date.now() + 4 * 86_400_000));
    expect(removed).toBeGreaterThanOrEqual(2);
    expect(await getDb().select().from(users).where(eq(users.id, a.id))).toHaveLength(0);
    expect(await getDb().select().from(contracts).where(eq(contracts.userId, a.id))).toHaveLength(0);
  });
});
