import type Anthropic from "@anthropic-ai/sdk";
import { aiEnabled, getClient, MODEL } from "./claude";

/**
 * "Ask the ledger" — a read-only agent over the freelancer's receivables. Tools are supplied by the
 * caller (DB + live PayPal Invoicing reads). It can look things up and draft text; it cannot send,
 * price or modify anything — writes stay behind human-approved UI actions.
 */
export interface AssistantTool {
  name: string;
  description: string;
  input_schema: Anthropic.Tool.InputSchema;
  run: (input: Record<string, unknown>) => Promise<unknown>;
}

export interface AssistantTrace {
  tool: string;
  input: unknown;
  ok: boolean;
}

const SYSTEM = `You are ProofBill's ledger assistant for a freelancer. Answer questions about their contracts, milestones, evidence and PayPal invoices using the tools. Be concise and specific: name invoice numbers, milestones, statuses, amounts and due dates exactly as the tools return them. Amounts come only from tool results — never compute or estimate new ones. You are read-only: if asked to send, change or create something, explain which button in ProofBill does it.`;

export async function askLedger(question: string, tools: AssistantTool[]): Promise<{ answer: string; trace: AssistantTrace[]; by: string }> {
  if (!aiEnabled()) {
    return { answer: "The ledger assistant needs ANTHROPIC_API_KEY. The ledger grid above has the same data.", trace: [], by: "none" };
  }
  const client = getClient();
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: question }];
  const trace: AssistantTrace[] = [];
  const defs: Anthropic.Tool[] = tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.input_schema }));
  let model = MODEL;
  for (let turn = 0; turn < 8; turn++) {
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 8000,
      system: SYSTEM,
      output_config: { effort: "low" },
      tools: defs,
      messages,
    });
    model = res.model;
    if (res.stop_reason === "refusal") return { answer: "I can't help with that request.", trace, by: model };
    messages.push({ role: "assistant", content: res.content });
    const uses = res.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    if (res.stop_reason !== "tool_use" || uses.length === 0) {
      const answer = res.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
      return { answer: answer || "(no answer)", trace, by: model };
    }
    const results: Anthropic.ToolResultBlockParam[] = await Promise.all(
      uses.map(async (u) => {
        const tool = tools.find((t) => t.name === u.name);
        try {
          if (!tool) throw new Error(`unknown tool ${u.name}`);
          const out = await tool.run((u.input ?? {}) as Record<string, unknown>);
          trace.push({ tool: u.name, input: u.input, ok: true });
          return { type: "tool_result" as const, tool_use_id: u.id, content: JSON.stringify(out).slice(0, 20000) };
        } catch (e) {
          trace.push({ tool: u.name, input: u.input, ok: false });
          return { type: "tool_result" as const, tool_use_id: u.id, content: String((e as Error).message), is_error: true };
        }
      }),
    );
    messages.push({ role: "user", content: results });
  }
  return { answer: "Stopped after too many lookups — try a narrower question.", trace, by: model };
}
