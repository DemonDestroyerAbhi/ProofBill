export type ActionState = { ok?: boolean; error?: string; message?: string; data?: unknown } | null;

/** Wrap a server action body: expected guardrail errors become form state, not 500s. */
export async function attempt(fn: () => Promise<string | void | { message?: string; data?: unknown }>): Promise<ActionState> {
  try {
    const r = await fn();
    if (typeof r === "string") return { ok: true, message: r };
    return { ok: true, ...(r ?? {}) };
  } catch (e) {
    // Next's redirect()/notFound() throw control-flow errors — rethrow those.
    if (e && typeof e === "object" && "digest" in e && typeof (e as { digest: unknown }).digest === "string" && /NEXT_/.test((e as { digest: string }).digest)) throw e;
    console.error(e);
    return { ok: false, error: (e as Error).message || "Something went wrong" };
  }
}
