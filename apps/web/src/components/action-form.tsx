"use client";

import { useActionState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import type { ActionState } from "@/lib/actions";

type Action = (state: ActionState, form: FormData) => Promise<ActionState>;

/** A form bound to a server action, with pending state and inline guardrail errors. */
export function ActionForm({
  action,
  children,
  className,
  confirm,
  showOk = true,
}: {
  action: Action;
  children: ReactNode;
  className?: string;
  confirm?: string;
  showOk?: boolean;
}) {
  const [state, run] = useActionState(action, null);
  return (
    <form
      action={run}
      className={className ?? "stack-sm"}
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      {children}
      {state?.error && <div className="form-msg error" role="alert">{state.error}</div>}
      {showOk && state?.ok && state.message && <div className="form-msg ok" role="status">{state.message}</div>}
    </form>
  );
}

export function Submit({ children, className = "btn", pendingText, name, value }: { children: ReactNode; className?: string; pendingText?: string; name?: string; value?: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={className} disabled={pending} name={name} value={value}>
      {pending ? pendingText ?? "Working…" : children}
    </button>
  );
}
