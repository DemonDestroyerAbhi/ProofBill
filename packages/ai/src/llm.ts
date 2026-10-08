import { GoogleGenAI } from "@google/genai";
import { z } from "zod";

/** Gemini model alias; override with GEMINI_MODEL (e.g. a pinned or Pro model). */
export const MODEL = process.env.GEMINI_MODEL ?? "gemini-flash-latest";

let client: GoogleGenAI | null = null;

function apiKey(): string | undefined {
  return process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || undefined;
}

/** AI is optional at runtime: without a key every feature falls back to a labelled deterministic path. */
export function aiEnabled(): boolean {
  return !!apiKey();
}

export function getClient(): GoogleGenAI {
  if (!client) client = new GoogleGenAI({ apiKey: apiKey() });
  return client;
}

export class AiBlockedError extends Error {
  constructor(public reason: string | undefined) {
    super(`Model returned no usable output${reason ? ` (${reason})` : ""}`);
  }
}

/**
 * zod → JSON Schema for Gemini's responseJsonSchema, normalised to the conservative subset:
 * no $schema marker, `type: [x, "null"]` → anyOf, and zod's ±2^53 integer sentinels dropped.
 */
export function jsonSchema(schema: z.ZodType): Record<string, unknown> {
  const { $schema: _drop, ...rest } = z.toJSONSchema(schema, { target: "draft-2020-12", io: "output" }) as Record<string, unknown>;
  return normalise(rest) as Record<string, unknown>;
}

function normalise(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(normalise);
  if (!node || typeof node !== "object") return node;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    if ((k === "minimum" || k === "maximum") && typeof v === "number" && Math.abs(v) >= Number.MAX_SAFE_INTEGER) continue;
    out[k] = normalise(v);
  }
  if (Array.isArray(out.type)) {
    const { type, description, ...others } = out;
    return {
      ...(description ? { description } : {}),
      anyOf: (type as string[]).map((t) => (t === "null" ? { type: "null" } : { ...others, type: t })),
    };
  }
  return out;
}

export interface StructuredResult<T> {
  data: T;
  model: string;
}

/**
 * One schema-constrained JSON call. The response is validated against the same zod schema before use;
 * every caller stores the result's rationale + source for the audit log.
 */
export async function structured<S extends z.ZodType>(args: {
  schema: S;
  system: string;
  user: string;
  maxTokens?: number;
}): Promise<StructuredResult<z.infer<S>>> {
  const res = await getClient().models.generateContent({
    model: MODEL,
    contents: [{ role: "user", parts: [{ text: args.user }] }],
    config: {
      systemInstruction: args.system,
      responseMimeType: "application/json",
      responseJsonSchema: jsonSchema(args.schema),
      maxOutputTokens: args.maxTokens ?? 16000,
      temperature: 0,
    },
  });
  const finish = res.candidates?.[0]?.finishReason;
  const text = res.text;
  if (!text) throw new AiBlockedError(res.promptFeedback?.blockReason ?? finish);
  if (finish === "MAX_TOKENS") throw new Error("AI output truncated (MAX_TOKENS)");
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error("AI returned invalid JSON");
  }
  const parsed = args.schema.safeParse(json);
  if (!parsed.success) throw new Error(`AI output failed schema validation: ${parsed.error.issues[0]?.path.join(".")} ${parsed.error.issues[0]?.message}`);
  return { data: parsed.data as z.infer<S>, model: res.modelVersion ?? MODEL };
}
