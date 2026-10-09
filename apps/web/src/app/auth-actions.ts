"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AuthError, signInWithPassword, signUpWithPassword } from "@proofbill/services";
import { encodeSession, homeFor, returnCookie, sessionCookie } from "@/lib/session";
import type { ActionState } from "@/lib/actions";

const s = (f: FormData, k: string) => String(f.get(k) ?? "");

/** Only same-site relative paths, so ?next= can't bounce users to another site. */
function safeNext(next: string): string | null {
  return /^\/(?!\/)[\w\-/.?=&%]*$/.test(next) ? next : null;
}

async function startSession(userId: string) {
  const jar = await cookies();
  jar.set(sessionCookie.name, encodeSession(userId), sessionCookie.options);
  jar.delete(returnCookie.name);
}

export async function signUpAction(_: ActionState, f: FormData): Promise<ActionState> {
  let dest = "/app";
  try {
    const role = s(f, "role") === "client" ? "client" : "freelancer";
    const u = await signUpWithPassword({ email: s(f, "email"), password: s(f, "password"), name: s(f, "name"), role });
    await startSession(u.id);
    dest = safeNext(s(f, "next")) ?? homeFor(u);
  } catch (e) {
    if (e instanceof AuthError) return { ok: false, error: e.message };
    throw e;
  }
  redirect(dest);
}

export async function signInAction(_: ActionState, f: FormData): Promise<ActionState> {
  let dest = "/app";
  try {
    const u = await signInWithPassword(s(f, "email"), s(f, "password"));
    await startSession(u.id);
    dest = safeNext(s(f, "next")) ?? homeFor(u);
  } catch (e) {
    if (e instanceof AuthError) return { ok: false, error: e.message };
    throw e;
  }
  redirect(dest);
}
