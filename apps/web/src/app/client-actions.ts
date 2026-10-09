"use server";

import { revalidatePath } from "next/cache";
import { linkPortalToClient, unlinkPortal } from "@proofbill/services";
import { requireClient } from "@/lib/session";
import { attempt, type ActionState } from "@/lib/actions";

export async function savePortalAction(token: string, _: ActionState): Promise<ActionState> {
  const user = await requireClient();
  const r = await attempt(async () => {
    await linkPortalToClient(user.id, token);
    return "Saved to your ProofBill account";
  });
  revalidatePath(`/portal/${token}`);
  revalidatePath("/client");
  return r;
}

export async function removePortalAction(contractId: string): Promise<void> {
  const user = await requireClient();
  await unlinkPortal(user.id, contractId);
  revalidatePath("/client");
}
