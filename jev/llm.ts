import { JevClient } from "./client.js";
import { JevError } from "./errors.js";
import {
  JevDecision,
  JevDecisionRequest,
  JevDecisionResult,
  JevQuestion,
  parseChoice,
  parseNoul,
  parseScore,
} from "./types.js";

/**
 * Provider-neutral LLM backing for Jev.
 *
 * The adapter core depends only on a `CompleteFn` — one injected function
 * that maps (system, user) prompts to raw text. Concrete providers plug in
 * below (`openaiCompatibleCompletion`) or by callers without touching this
 * file. Nothing here is coupled to Claude Code, DeepSeek Harness, or OpenCode.
 */
export type CompleteFn = (system: string, user: string) => Promise<string>;

export interface LlmJevClientOptions {
  readonly complete: CompleteFn;
  readonly model: string;
  readonly timeoutMs?: number;
  readonly log?: (event: string, fields: Record<string, string | number>) => void;
}

function describeQuestion(q: JevQuestion<JevDecision>): string {
  const base = `- key "${q.key}" [${q.type}]`;
  if (q.type === "choice") {
    const opts = (q.options ?? []).map((o) => `"${o}"`).join(", ");
    return `${base} options: ${opts}. Reply {"kind":"choice","selected":<one option>,"probabilities":{<option>:<0..1>},"confidence":<0..1>}.`;
  }
  if (q.type === "score") {
    return `${base}. Reply {"kind":"score","value":<0..1>,"confidence":<0..1>}.`;
  }
  return `${base}. Reply {"kind":"noul","value":<true|false|null; null = abstain>,"confidence":<0..1>}.`;
}

const SYSTEM_PROMPT =
  "You are Jev, a typed decision engine. Reply with ONLY a single JSON object " +
  "mapping each question key to its decision object. No prose, no code fences. " +
  "Probabilities for a choice must cover every listed option and sum to 1.";

function buildUserPrompt(request: JevDecisionRequest): string {
  const lines = request.questions.map(describeQuestion);
  const context = request.questions
    .map((q) => {
      if (!q.context || Object.keys(q.context).length === 0) return null;
      const pairs = Object.entries(q.context)
        .map(([k, v]) => `${k}=${String(v)}`)
        .join("; ");
      return `context for "${q.key}": ${pairs}`;
    })
    .filter((c): c is string => c !== null);
  return (
    `Questions:\n${lines.join("\n")}` +
    (context.length > 0 ? `\nShared context:\n${context.join("\n")}` : "") +
    `\nReply JSON now.`
  );
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new JevError("TIMEOUT", `Jev LLM timed out after ${ms}ms.`, true)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export class LlmJevClient implements JevClient {
  private readonly complete: CompleteFn;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly log:
    | ((event: string, fields: Record<string, string | number>) => void)
    | undefined;

  constructor(options: LlmJevClientOptions) {
    if (!options.model) throw new JevError("NOT_CONFIGURED", "Jev LLM model is not configured.");
    this.complete = options.complete;
    this.model = options.model;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.log = options.log;
  }

  async decide<TDecision extends JevDecision>(
    request: JevDecisionRequest<TDecision>,
  ): Promise<JevDecisionResult<TDecision>> {
    const started = Date.now();
    let raw: string;
    try {
      raw = await withTimeout(
        this.complete(SYSTEM_PROMPT, buildUserPrompt(request)),
        this.timeoutMs,
      );
    } catch (err) {
      if (err instanceof JevError) throw err;
      throw new JevError(
        "NETWORK",
        err instanceof Error ? `Jev LLM failure: ${err.message}` : "Jev LLM failure.",
        true,
      );
    }
    const parsed = parseEnvelope(raw);
    const answers = request.questions.map((q) => {
      const decision = coerceAnswer(q as JevQuestion<JevDecision>, parsed[q.key]);
      if (!decision) {
        throw new JevError("INVALID_DECISION", `Jev LLM returned an invalid decision for "${q.key}".`);
      }
      return { key: q.key, decision: decision as TDecision };
    });
    this.log?.("jev.llm.ok", {
      caller: request.caller,
      questions: request.questions.length,
      latencyMs: Date.now() - started,
    });
    return { requestId: request.requestId, answers, model: this.model, latencyMs: Date.now() - started };
  }
}

function parseEnvelope(raw: string): Record<string, unknown> {
  const text = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new JevError("BAD_RESPONSE", "Jev LLM did not return JSON.");
  }
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    throw new JevError("BAD_RESPONSE", "Jev LLM returned a non-object envelope.");
  }
  return payload as Record<string, unknown>;
}

function coerceAnswer(
  question: JevQuestion<JevDecision>,
  value: unknown,
): JevDecision | null {
  if (value === undefined) return null;
  if (question.type === "choice") return parseChoice(value, question.options ?? []);
  if (question.type === "score") return parseScore(value);
  return parseNoul(value);
}

// ---------------------------------------------------------------------------
// Provider shims (fetch only, no SDKs). Each returns a CompleteFn.
// ---------------------------------------------------------------------------

export interface OpenAiCompatibleOptions {
  /** Base URL, e.g. https://api.deepseek.com — `/chat/completions` appended. */
  readonly endpoint: string;
  readonly apiKey: string;
  readonly model: string;
  readonly timeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
}

/** Covers OpenAI, DeepSeek, OpenRouter, and OpenAI-compatible gateways. */
export function openaiCompatibleCompletion(options: OpenAiCompatibleOptions): CompleteFn {
  const base = options.endpoint.replace(/\/+$/, "");
  const timeoutMs = options.timeoutMs ?? 30_000;
  const fetchImpl = options.fetchImpl ?? fetch;
  return async (system: string, user: string): Promise<string> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(`${base}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${options.apiKey}`,
        },
        body: JSON.stringify({
          model: options.model,
          temperature: 0,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
        }),
        signal: controller.signal,
      });
      if (response.status === 401 || response.status === 403) {
        throw new JevError("AUTH", "Jev provider rejected credentials.");
      }
      if (!response.ok) {
        throw new JevError("NETWORK", `Jev provider failed (status ${response.status}).`, true);
      }
      const payload = (await response.json()) as {
        choices?: { message?: { content?: string } }[];
      };
      const content = payload.choices?.[0]?.message?.content;
      if (typeof content !== "string" || content.length === 0) {
        throw new JevError("BAD_RESPONSE", "Jev provider returned empty content.");
      }
      return content;
    } catch (err) {
      if (err instanceof JevError) throw err;
      if (err instanceof Error && err.name === "AbortError") {
        throw new JevError("TIMEOUT", `Jev provider timed out after ${timeoutMs}ms.`, true);
      }
      throw new JevError(
        "NETWORK",
        err instanceof Error ? `Jev provider network failure: ${err.message}` : "Jev provider network failure.",
        true,
      );
    } finally {
      clearTimeout(timer);
    }
  };
}
