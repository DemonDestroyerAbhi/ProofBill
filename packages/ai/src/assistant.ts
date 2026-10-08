import type { Content, FunctionCall, Part } from "@google/genai";
import { aiEnabled, getClient, MODEL } from "./llm";

/**
 * "Ask the ledger" — a read-only agent over the freelancer's receivables. Tools are supplied by the
 * caller (DB + live PayPal Invoicing reads). It can look things up and draft text; it cannot send,
 * price or modify anything — writes stay behind human-approved UI actions.
 */
export interface AssistantTool {
  name: string;
  description: string;
  /** JSON Schema for the tool's arguments. */
  parameters: Record<string, unknown>;
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
    return { answer: "The ledger assistant needs GEMINI_API_KEY. The ledger grid below has the same data.", trace: [], by: "none" };
  }
  const ai = getClient();
  const contents: Content[] = [{ role: "user", parts: [{ text: question }] }];
  const trace: AssistantTrace[] = [];
  const decls = tools.map((t) => ({ name: t.name, description: t.description, parametersJsonSchema: t.parameters }));
  let model = MODEL;
  for (let turn = 0; turn < 8; turn++) {
    const res = await ai.models.generateContent({
      model: MODEL,
      contents,
      config: { systemInstruction: SYSTEM, tools: [{ functionDeclarations: decls }], temperature: 0, maxOutputTokens: 8000 },
    });
    model = res.modelVersion ?? MODEL;
    const content = res.candidates?.[0]?.content;
    const calls: FunctionCall[] = res.functionCalls ?? [];
    if (!content || calls.length === 0) {
      const answer = res.text?.trim();
      return { answer: answer || "I couldn't answer that.", trace, by: model };
    }
    contents.push(content);
    const parts: Part[] = await Promise.all(
      calls.map(async (call) => {
        const tool = tools.find((t) => t.name === call.name);
        try {
          if (!tool) throw new Error(`unknown tool ${call.name}`);
          const out = await tool.run((call.args ?? {}) as Record<string, unknown>);
          trace.push({ tool: call.name ?? "?", input: call.args, ok: true });
          return { functionResponse: { id: call.id, name: call.name, response: { result: JSON.parse(JSON.stringify(out ?? null)) } } };
        } catch (e) {
          trace.push({ tool: call.name ?? "?", input: call.args, ok: false });
          return { functionResponse: { id: call.id, name: call.name, response: { error: (e as Error).message } } };
        }
      }),
    );
    contents.push({ role: "user", parts });
  }
  return { answer: "Stopped after too many lookups — try a narrower question.", trace, by: model };
}
