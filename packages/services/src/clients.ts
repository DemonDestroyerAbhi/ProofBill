import { and, asc, clientLinks, clients, contracts, desc, eq, getDb, inArray, invoices, milestones, users } from "@proofbill/db";
import { NotFoundError } from "./contracts";

/**
 * Client accounts: one place for every portal a client has received, across freelancers.
 * Linking requires opening the portal link while signed in (possession of the unguessable token),
 * never just a matching email — anyone can type someone else's email.
 */
export async function linkPortalToClient(clientUserId: string, portalToken: string): Promise<void> {
  const db = getDb();
  const [u] = await db.select().from(users).where(eq(users.id, clientUserId));
  if (u?.role !== "client") throw new Error("Only client accounts can save portals");
  const [c] = await db.select().from(contracts).where(eq(contracts.portalToken, portalToken));
  if (!c || c.status === "draft") throw new NotFoundError("Portal");
  await db.insert(clientLinks).values({ userId: clientUserId, contractId: c.id }).onConflictDoNothing();
}

export async function unlinkPortal(clientUserId: string, contractId: string): Promise<void> {
  await getDb().delete(clientLinks).where(and(eq(clientLinks.userId, clientUserId), eq(clientLinks.contractId, contractId)));
}

export async function isPortalLinked(clientUserId: string, portalToken: string): Promise<boolean> {
  const [row] = await getDb()
    .select({ id: clientLinks.id })
    .from(clientLinks)
    .innerJoin(contracts, eq(clientLinks.contractId, contracts.id))
    .where(and(eq(clientLinks.userId, clientUserId), eq(contracts.portalToken, portalToken)));
  return !!row;
}

/** The client dashboard: every saved contract with its freelancer, what needs review and what's owed. */
export async function clientDashboard(clientUserId: string) {
  const db = getDb();
  const rows = await db
    .select({ contract: contracts, freelancer: users, client: clients, linkedAt: clientLinks.createdAt })
    .from(clientLinks)
    .innerJoin(contracts, eq(clientLinks.contractId, contracts.id))
    .innerJoin(users, eq(contracts.userId, users.id))
    .leftJoin(clients, eq(contracts.clientId, clients.id))
    .where(eq(clientLinks.userId, clientUserId))
    .orderBy(desc(clientLinks.createdAt));
  if (!rows.length) return [];
  const ids = rows.map((r) => r.contract.id);
  const [ms, invs] = await Promise.all([
    db.select().from(milestones).where(inArray(milestones.contractId, ids)).orderBy(asc(milestones.number)),
    db.select().from(invoices).where(inArray(invoices.contractId, ids)),
  ]);
  return rows.map((r) => {
    const cm = ms.filter((m) => m.contractId === r.contract.id);
    const open = invs.filter((i) => i.contractId === r.contract.id && ["SENT", "PARTIALLY_PAID", "UNPAID"].includes(i.status));
    return {
      contractId: r.contract.id,
      title: r.contract.title,
      portalToken: r.contract.portalToken,
      currency: r.contract.currency,
      freelancer: r.freelancer.name || r.freelancer.login,
      clientName: r.client?.name ?? null,
      awaitingReview: cm.filter((m) => m.status === "submitted").length,
      accepted: cm.filter((m) => ["accepted", "invoiced", "paid"].includes(m.status)).length,
      milestones: cm.length,
      dueCents: open.reduce((s, i) => s + i.amountCents - i.paidCents, 0),
      openInvoices: open.length,
    };
  });
}
