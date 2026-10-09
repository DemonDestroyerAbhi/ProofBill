import { addBusinessDays } from "./dates";

export const MILESTONE_STATUSES = [
  "planned",
  "in_progress",
  "submitted",
  "accepted",
  "rejected",
  "invoiced",
  "paid",
] as const;
export type MilestoneStatus = (typeof MILESTONE_STATUSES)[number];

type Action = "start" | "submit" | "accept" | "reject" | "auto_accept" | "invoice" | "pay" | "reopen";

const TRANSITIONS: Record<Action, { from: MilestoneStatus[]; to: MilestoneStatus }> = {
  start: { from: ["planned"], to: "in_progress" },
  submit: { from: ["planned", "in_progress", "rejected"], to: "submitted" },
  accept: { from: ["submitted"], to: "accepted" },
  auto_accept: { from: ["submitted"], to: "accepted" },
  reject: { from: ["submitted"], to: "rejected" },
  invoice: { from: ["accepted"], to: "invoiced" },
  pay: { from: ["invoiced"], to: "paid" },
  reopen: { from: ["invoiced"], to: "accepted" }, // invoice cancelled
};

export class TransitionError extends Error {
  constructor(public action: string, public from: string) {
    super(`Cannot ${action} a milestone that is ${from}`);
  }
}

export function transition(from: MilestoneStatus, action: Action): MilestoneStatus {
  const t = TRANSITIONS[action];
  if (!t.from.includes(from)) throw new TransitionError(action, from);
  return t.to;
}

export function canTransition(from: MilestoneStatus, action: Action): boolean {
  return TRANSITIONS[action].from.includes(from);
}

export interface DepMilestone {
  id: string;
  number: number;
  status: MilestoneStatus;
  dependsOn: number[];
}

/** A milestone can only be submitted once everything it depends on has been accepted (or later). */
export function blockingDependencies(m: DepMilestone, all: DepMilestone[]): DepMilestone[] {
  const done: MilestoneStatus[] = ["accepted", "invoiced", "paid"];
  return m.dependsOn
    .map((n) => all.find((x) => x.number === n))
    .filter((x): x is DepMilestone => !!x && !done.includes(x.status));
}

export function acceptanceDeadline(submittedAt: Date, windowBizDays: number): Date {
  return addBusinessDays(submittedAt, windowBizDays);
}

/** Contract: "Silence after N business days counts as acceptance." */
export function isAutoAcceptDue(
  m: { status: MilestoneStatus; acceptanceDeadline: Date | null },
  now: Date,
): boolean {
  return m.status === "submitted" && m.acceptanceDeadline != null && now.getTime() >= m.acceptanceDeadline.getTime();
}
