import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";

export const MODEL = process.env.PROOFBILL_MODEL ?? "claude-opus-5-5";

let client: Anthropic | null = null;

/** AI is optional at runtime: without a key every feature falls back to a labelled deterministic path. */
export function aiEnabled(): boolean {
  return !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

export function getClient(): Anthropic {
  if (!client) client = new Anthropic();
  return client;
}

export class AiRefusalError extends Error {
  constructor(public category: string | null | undefined) {
    super(`Model declined the request${category ? ` (${category})` : ""}`);
  }
}

export interface StructuredResult<T> {
  data: T;
  model: string;
}

/**
 * One structured-output call. Schema-constrained JSON (output_config.format), server-side refusal
 * fallback, explicit effort. Every caller stores the result's rationale + source for the audit log.
 */
export async function structured<S extends z.ZodType>(args: {
  schema: S;
  system: string;
  user: Anthropic.Beta.BetaContentBlockParam[] | string;
  effort?: "low" | "medium" | "high";
  maxTokens?: number;
}): Promise<StructuredResult<z.infer<S>>> {
  const res = await getClient().beta.messages.parse({
    model: MODEL,
    max_tokens: args.maxTokens ?? 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: args.system,
    output_config: { effort: args.effort ?? "medium", format: betaZodOutputFormat(args.schema) },
    messages: [{ role: "user", content: args.user }],
  });
  if (res.stop_reason === "refusal") throw new AiRefusalError(res.stop_details?.category);
  if (res.stop_reason === "max_tokens") throw new Error("AI output truncated (max_tokens)");
  if (res.parsed_output == null) throw new Error("AI returned no parseable output");
  return { data: res.parsed_output as z.infer<S>, model: res.model };
}
