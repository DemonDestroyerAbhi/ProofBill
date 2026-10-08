"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ConfirmedTerms } from "@proofbill/core";
import {
  addManualEvidence,
  addRepo,
  addTimeEntry,
  approveAndSend,
  buildInvoiceDraft,
  cancelInvoice,
  clientDecision,
  confirmContract,
  createDraftFromText,
  deleteDraft,
  deleteTimeEntry,
  discardDraft,
  documentToText,
  duplicateInvoiceProbe,
  getContract,
  mapPendingEvidence,
  pollRepo,
  probeOverCap,
  reviewEvidence,
  sendReminder,
  simulatePayment,
  submitMilestone,
  syncInvoiceFromPayPal,
  updateDraftText,
  seedDemoWorkspace,
  reconcileInvoice,
} from "@proofbill/services";
import { getDb, invoices, eq, repos } from "@proofbill/db";
import { requireUser } from "@/lib/session";
import { attempt, type ActionState } from "@/lib/actions";

const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

export async function uploadContractAction(_: ActionState, f: FormData): Promise<ActionState> {
  const user = await requireUser();
  let id = "";
  const r = await attempt(async () => {
    const file = f.get("file");
    let name = "pasted-contract.txt";
    let text = s(f, "text");
    if (file instanceof File && file.size > 0) {
      if (file.size > 10 * 1024 * 1024) throw new Error("Contracts up to 10 MB");
      name = file.name;
      text = await documentToText(file.name, new Uint8Array(await file.arrayBuffer()));
    }
    if (!text) throw new Error("Upload a PDF/DOCX/TXT/MD file or paste the contract text");
    id = (await createDraftFromText(user.id, { name, text })).id;
  });
  if (r?.ok) redirect(`/app/contracts/${id}/review`);
  return r;
}

export async function confirmTermsAction(contractId: string, terms: ConfirmedTerms): Promise<ActionState> {
  const user = await requireUser();
  const r = await attempt(async () => {
    const { issues } = await confirmContract(user.id, contractId, terms);
    const errs = issues.filter((i) => i.level === "error");
    if (errs.length) throw new Error(errs.map((e) => e.message).join(" · "));
  });
  if (r?.ok) redirect(`/app/contracts/${contractId}`);
  return r;
}

export async function deleteDraftAction(contractId: string): Promise<void> {
  const user = await requireUser();
  await deleteDraft(user.id, contractId);
  redirect("/app");
}

export async function reviewEvidenceAction(contractId: string, _: ActionState, f: FormData): Promise<ActionState> {
  const user = await requireUser();
  const r = await attempt(async () => {
    const action = s(f, "action");
    const id = s(f, "evidenceId");
    if (action === "confirm") await reviewEvidence(user.id, id, { action: "confirm", milestoneId: s(f, "milestoneId") });
    else if (action === "reject") await reviewEvidence(user.id, id, { action: "reject" });
    else await reviewEvidence(user.id, id, { action: "unassign" });
  });
  revalidatePath(`/app/contracts/${contractId}`);
  return r;
}

export async function addRepoAction(contractId: string, _: ActionState, f: FormData): Promise<ActionState> {
  const user = await requireUser();
  const r = await attempt(async () => {
    await addRepo(user.id, contractId, s(f, "repo"));
    const [repo] = await getDb().select().from(repos).where(eq(repos.contractId, contractId));
    const all = await getDb().select().from(repos).where(eq(repos.contractId, contractId));
    let n = 0;
    for (const x of all.length ? all : repo ? [repo] : []) n += await pollRepo(x.id);
    await mapPendingEvidence(contractId);
    return `Connected. ${n} merged PR${n === 1 ? "" : "s"} captured and mapped.`;
  });
  revalidatePath(`/app/contracts/${contractId}`);
  return r;
}

export async function pollReposAction(contractId: string, _: ActionState): Promise<ActionState> {
  const user = await requireUser();
  const r = await attempt(async () => {
    await getContract(user.id, contractId);
    const all = await getDb().select().from(repos).where(eq(repos.contractId, contractId));
    let n = 0;
    for (const x of all) n += await pollRepo(x.id);
    const mapped = await mapPendingEvidence(contractId);
    return `${n} new merged PR${n === 1 ? "" : "s"}, ${mapped} mapped.`;
  });
  revalidatePath(`/app/contracts/${contractId}`);
  return r;
}

export async function addManualEvidenceAction(contractId: string, _: ActionState, f: FormData): Promise<ActionState> {
  const user = await requireUser();
  const r = await attempt(async () => {
    const milestoneId = s(f, "milestoneId") || null;
    const file = f.get("file");
    if (file instanceof File && file.size > 0) {
      await addManualEvidence(user.id, contractId, {
        kind: "file",
        name: file.name,
        mime: file.type,
        bytes: new Uint8Array(await file.arrayBuffer()),
        title: s(f, "title"),
        milestoneId,
      });
    } else {
      await addManualEvidence(user.id, contractId, { kind: "link", url: s(f, "url"), title: s(f, "title"), milestoneId });
    }
    if (!milestoneId) await mapPendingEvidence(contractId);
    return "Evidence added";
  });
  revalidatePath(`/app/contracts/${contractId}`);
  return r;
}

export async function submitMilestoneAction(contractId: string, milestoneId: string, _: ActionState, f: FormData): Promise<ActionState> {
  const user = await requireUser();
  const r = await attempt(async () => {
    await submitMilestone(user.id, milestoneId, s(f, "note") || null);
    return "Submitted — the client has been given the evidence portal link.";
  });
  revalidatePath(`/app/contracts/${contractId}`);
  return r;
}

export async function addTimeAction(contractId: string, milestoneId: string, _: ActionState, f: FormData): Promise<ActionState> {
  const user = await requireUser();
  const r = await attempt(() => addTimeEntry(user.id, milestoneId, { date: s(f, "date"), hours: Number(s(f, "hours")), note: s(f, "note") }));
  revalidatePath(`/app/contracts/${contractId}`);
  return r;
}

export async function deleteTimeAction(contractId: string, entryId: string): Promise<void> {
  const user = await requireUser();
  await deleteTimeEntry(user.id, entryId);
  revalidatePath(`/app/contracts/${contractId}`);
}

export async function buildInvoiceAction(milestoneId: string, _: ActionState): Promise<ActionState> {
  const user = await requireUser();
  let id = "";
  const r = await attempt(async () => {
    id = (await buildInvoiceDraft(user.id, milestoneId)).id;
  });
  if (r?.ok) redirect(`/app/invoices/${id}`);
  return r;
}

export async function saveDraftAction(invoiceId: string, _: ActionState, f: FormData): Promise<ActionState> {
  const user = await requireUser();
  const r = await attempt(async () => {
    const lines = [...f.keys()].filter((k) => k.startsWith("line:")).map((k) => ({ id: k.slice(5), description: s(f, k) }));
    await updateDraftText(user.id, invoiceId, { note: s(f, "note"), lines });
    return "Saved";
  });
  revalidatePath(`/app/invoices/${invoiceId}`);
  return r;
}

export async function sendInvoiceAction(invoiceId: string, _: ActionState): Promise<ActionState> {
  const user = await requireUser();
  const r = await attempt(async () => {
    await approveAndSend(user.id, invoiceId);
    return "Sent via PayPal";
  });
  revalidatePath(`/app/invoices/${invoiceId}`);
  return r;
}

export async function discardDraftAction(invoiceId: string, contractId: string): Promise<void> {
  const user = await requireUser();
  await discardDraft(user.id, invoiceId);
  redirect(`/app/contracts/${contractId}`);
}

async function ownInvoice(userId: string, invoiceId: string) {
  const [inv] = await getDb().select().from(invoices).where(eq(invoices.id, invoiceId));
  if (!inv) throw new Error("Invoice not found");
  await getContract(userId, inv.contractId);
  return inv;
}

export async function remindAction(invoiceId: string, _: ActionState): Promise<ActionState> {
  const user = await requireUser();
  const r = await attempt(async () => {
    await ownInvoice(user.id, invoiceId);
    const rem = await sendReminder(invoiceId, "user");
    return { message: `Reminder sent (${rem.tone}): “${rem.subject}”`, data: rem };
  });
  revalidatePath(`/app/invoices/${invoiceId}`);
  return r;
}

export async function refreshInvoiceAction(invoiceId: string, _: ActionState): Promise<ActionState> {
  const user = await requireUser();
  const r = await attempt(async () => {
    await ownInvoice(user.id, invoiceId);
    const inv = await syncInvoiceFromPayPal(invoiceId, "manual refresh");
    return `PayPal status: ${inv?.status ?? "not on PayPal"}`;
  });
  revalidatePath(`/app/invoices/${invoiceId}`);
  return r;
}

export async function reconcileAction(invoiceId: string, _: ActionState): Promise<ActionState> {
  const user = await requireUser();
  const r = await attempt(async () => {
    await ownInvoice(user.id, invoiceId);
    const res = await reconcileInvoice(invoiceId);
    if (res.status === "skipped") return "Nothing to reconcile yet — no payments received";
    const label = { matched: "Matched ✓", pending: "Pending — Transaction Search can lag up to 3 hours", mismatch: "Mismatch — see invoice history" }[res.status];
    return `${label}. ${res.newTransactions} new transaction${res.newTransactions === 1 ? "" : "s"}.`;
  });
  revalidatePath(`/app/invoices/${invoiceId}`);
  return r;
}

export async function cancelInvoiceAction(invoiceId: string, _: ActionState): Promise<ActionState> {
  const user = await requireUser();
  const r = await attempt(async () => {
    await cancelInvoice(user.id, invoiceId);
    return "Cancelled on PayPal";
  });
  revalidatePath(`/app/invoices/${invoiceId}`);
  return r;
}

export async function duplicateProbeAction(invoiceId: string, _: ActionState): Promise<ActionState> {
  const user = await requireUser();
  const r = await attempt(async () => {
    const p = await duplicateInvoiceProbe(user.id, invoiceId);
    if (p.status === 422) return `Blocked ✓ PayPal answered ${p.status} ${p.issue}`;
    throw new Error(p.message);
  });
  revalidatePath(`/app/invoices/${invoiceId}`);
  return r;
}

export async function capProbeAction(contractId: string, _: ActionState): Promise<ActionState> {
  const user = await requireUser();
  const r = await attempt(async () => {
    const p = await probeOverCap(user.id, contractId);
    if (!p.blocked) throw new Error(p.message);
    return `Blocked ✓ ${p.message}`;
  });
  revalidatePath(`/app/contracts/${contractId}`);
  return r;
}

export async function resetDemoAction(): Promise<void> {
  const user = await requireUser();
  if (!user.isDemo) throw new Error("Only the demo workspace can be reset");
  await seedDemoWorkspace(user.id, { reset: true });
  redirect("/app");
}

/** Client portal — authorised by the portal token, not a session. */
export async function clientDecisionAction(token: string, milestoneId: string, _: ActionState, f: FormData): Promise<ActionState> {
  const r = await attempt(async () => {
    const action = s(f, "action");
    const name = s(f, "name") || undefined;
    if (action === "accept") await clientDecision(token, milestoneId, { action: "accept", name });
    else await clientDecision(token, milestoneId, { action: "reject", reason: s(f, "reason"), name });
    return action === "accept" ? "Accepted — thank you!" : "Sent back with your notes.";
  });
  revalidatePath(`/portal/${token}`);
  return r;
}

/** Offline PayPal simulator (PAYPAL_ENV=mock only). */
export async function mockPayAction(paypalId: string, _: ActionState, f: FormData): Promise<ActionState> {
  const r = await attempt(async () => {
    const amount = Number(s(f, "amount"));
    if (!(amount > 0)) throw new Error("Enter an amount");
    await simulatePayment(paypalId, Math.round(amount * 100));
    return "Payment received";
  });
  revalidatePath(`/mock-paypal/pay/${paypalId}`);
  return r;
}
