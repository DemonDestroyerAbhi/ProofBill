import { z } from "zod";
import { aiEnabled, structured } from "./claude";
import { mentionsMoney } from "./lines";

export const ReminderOutput = z.object({
  subject: z.string(),
  note: z.string().describe("The reminder message body, 2–5 sentences"),
  tone: z.enum(["friendly", "firm", "final"]),
  rationale: z.string().describe("Why this tone, in one sentence"),
});
export type ReminderOutput = z.infer<typeof ReminderOutput>;

export interface ReminderContext {
  clientName: string;
  freelancerName: string;
  invoiceNumber: string;
  milestoneTitle: string;
  daysOverdue: number;
  reminderCount: number;
  partiallyPaid: boolean;
  acceptedBy: string | null;
  lateFeePctMonthly: number | null;
}

const SYSTEM = `You write payment reminder notes that a freelancer sends to a client through PayPal's invoice reminder.

Tone matching:
- First reminder and under 14 days overdue → friendly: assume oversight.
- Second/third reminder or 14–45 days → firm: polite, direct, reference the accepted milestone and the contract's payment terms.
- Beyond that → final: courteous but clear about next steps under the contract.
Rules: never threaten legal action; never state amounts (PayPal shows the balance); mention a late fee only if the contract has one, as "per the contract's late-fee clause"; if partially paid, thank them for the payment received.`;

export async function writeReminder(ctx: ReminderContext): Promise<ReminderOutput & { by: string }> {
  const fb = templateReminder(ctx);
  if (!aiEnabled()) return { ...fb, by: "template" };
  const { data, model } = await structured({
    schema: ReminderOutput,
    system: SYSTEM,
    effort: "low",
    maxTokens: 2000,
    user: JSON.stringify(ctx),
  });
  if (mentionsMoney(data.note) || mentionsMoney(data.subject)) return { ...fb, by: "template", rationale: "AI draft mentioned an amount; template used" };
  return { ...data, by: model };
}

export function templateReminder(ctx: ReminderContext): ReminderOutput {
  const tone: ReminderOutput["tone"] =
    ctx.daysOverdue > 45 || ctx.reminderCount >= 3 ? "final" : ctx.daysOverdue >= 14 || ctx.reminderCount >= 1 ? "firm" : "friendly";
  const thanks = ctx.partiallyPaid ? "Thank you for the payment already received. " : "";
  const fee = ctx.lateFeePctMonthly ? " Please note the contract's late-fee clause applies to overdue balances." : "";
  const notes: Record<ReminderOutput["tone"], string> = {
    friendly: `Hi ${ctx.clientName}, ${thanks}${thanks ? "Just" : "just"} a friendly reminder that invoice ${ctx.invoiceNumber} for "${ctx.milestoneTitle}" is now due. The evidence for each acceptance criterion is linked on the invoice. Thanks!`,
    firm: `Hi ${ctx.clientName}, ${thanks}invoice ${ctx.invoiceNumber} for the accepted milestone "${ctx.milestoneTitle}" is ${ctx.daysOverdue} days past due. Could you arrange payment this week?${fee}`,
    final: `Hi ${ctx.clientName}, ${thanks}invoice ${ctx.invoiceNumber} for "${ctx.milestoneTitle}" remains unpaid ${ctx.daysOverdue} days after its due date. Please settle the balance or contact me so we can agree a plan.${fee}`,
  };
  return {
    subject: `${tone === "friendly" ? "Reminder" : tone === "firm" ? "Overdue" : "Final reminder"}: invoice ${ctx.invoiceNumber}`,
    note: notes[tone],
    tone,
    rationale: `Template: ${ctx.daysOverdue} days overdue, reminder #${ctx.reminderCount + 1}`,
  };
}
