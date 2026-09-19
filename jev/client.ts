import { JevError } from "./errors.js";
import {
  JevDecision,
  JevDecisionRequest,
  JevDecisionResult,
} from "./types.js";

/**
 * Provider-neutral Jev client. Implementations speak one HTTP contract;
 * nothing here is coupled to Claude Code or DeepSeek Harness.
 */
export interface JevClient {
  decide<TDecision extends JevDecision>(
    request: JevDecisionRequest<TDecision>,
  ): Promise<JevDecisionResult<TDecision>>;
}

export interface JevClientOptions {
  readonly endpoint: string;
  readonly apiKey: string;
  readonly model: string;
  readonly timeoutMs: number;
  /** Max attempts including the first try (default 2). Retries 429/5xx/timeout. */
  readonly maxAttempts?: number;
  /**
   * Redacted request/response logger supplied by the host app.
   * The client never passes secrets to it — see `sanitizeForLog`.
   */
  readonly log?: (event: string, fields: Record<string, string | number>) => void;
  readonly fetchImpl?: typeof fetch;
}

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class HttpJevClient implements JevClient {
  private readonly endpoint: string;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly maxAttempts: number;
  private readonly log:
    | ((event: string, fields: Record<string, string | number>) => void)
    | undefined;
  private readonly fetchImpl: typeof fetch;

  constructor(options: JevClientOptions) {
    if (!options.endpoint) throw new JevError("NOT_CONFIGURED", "Jev endpoint is not configured.");
    if (!options.apiKey) throw new JevError("NOT_CONFIGURED", "Jev API key is not configured.");
    if (!options.model) throw new JevError("NOT_CONFIGURED", "Jev model is not configured.");
    if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) {
      throw new JevError("NOT_CONFIGURED", "Jev timeoutMs must be a positive number.");
    }
    this.endpoint = options.endpoint.replace(/\/+$/, "");
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.timeoutMs = options.timeoutMs;
    this.maxAttempts = options.maxAttempts ?? 2;
    this.log = options.log;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async decide<TDecision extends JevDecision>(
    request: JevDecisionRequest<TDecision>,
  ): Promise<JevDecisionResult<TDecision>> {
    const started = Date.now();
    let attempt = 0;
    let lastError: unknown = null;
    while (attempt < this.maxAttempts) {
      attempt += 1;
      try {
        const result = await this.attempt<TDecision>(request);
        this.log?.("jev.decide.ok", {
          caller: request.caller,
          questions: request.questions.length,
          attempts: attempt,
          latencyMs: Date.now() - started,
        });
        return result;
      } catch (err) {
        lastError = err;
        const retryable =
          err instanceof JevError ? err.retryable : false;
        this.log?.("jev.decide.error", {
          caller: request.caller,
          attempts: attempt,
          code: err instanceof JevError ? err.code : "UNKNOWN",
        });
        if (!retryable || attempt >= this.maxAttempts) break;
        await sleep(100 * 2 ** (attempt - 1));
      }
    }
    throw lastError instanceof JevError
      ? lastError
      : new JevError("NETWORK", "Jev request failed.");
  }

  private async attempt<TDecision extends JevDecision>(
    request: JevDecisionRequest<TDecision>,
  ): Promise<JevDecisionResult<TDecision>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(`${this.endpoint}/v1/decide`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          requestId: request.requestId,
          caller: request.caller,
          questions: request.questions,
        }),
        signal: controller.signal,
      });
      if (response.status === 401 || response.status === 403) {
        throw new JevError("AUTH", `Jev rejected credentials (status ${response.status}).`);
      }
      if (RETRYABLE_STATUS.has(response.status)) {
        throw new JevError(
          "NETWORK",
          `Jev transient failure (status ${response.status}).`,
          true,
        );
      }
      if (!response.ok) {
        throw new JevError("NETWORK", `Jev request failed (status ${response.status}).`);
      }
      const payload: unknown = await response.json();
      return this.parseResult<TDecision>(request, payload);
    } catch (err) {
      if (err instanceof JevError) throw err;
      if (err instanceof Error && err.name === "AbortError") {
        throw new JevError("TIMEOUT", `Jev timed out after ${this.timeoutMs}ms.`, true);
      }
      throw new JevError(
        "NETWORK",
        err instanceof Error ? `Jev network failure: ${err.message}` : "Jev network failure.",
        true,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  private parseResult<TDecision extends JevDecision>(
    request: JevDecisionRequest<TDecision>,
    payload: unknown,
  ): JevDecisionResult<TDecision> {
    if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
      throw new JevError("BAD_RESPONSE", "Jev returned a non-object payload.");
    }
    const record = payload as Record<string, unknown>;
    if (!Array.isArray(record["answers"])) {
      throw new JevError("BAD_RESPONSE", "Jev response is missing `answers`.");
    }
    const answers = record["answers"] as unknown[];
    if (answers.length !== request.questions.length) {
      throw new JevError("BAD_RESPONSE", "Jev returned a different answer count than requested.");
    }
    const model = typeof record["model"] === "string" ? record["model"] : this.model;
    const latencyMs =
      typeof record["latencyMs"] === "number" ? record["latencyMs"] : undefined;
    // Shape validation of each decision happens in decisions.ts via
    // parseChoice/parseScore/parseNoul, where the expected type is known.
    // Here we only enforce envelope integrity.
    for (const answer of answers) {
      if (typeof answer !== "object" || answer === null) {
        throw new JevError("BAD_RESPONSE", "Jev returned a malformed answer.");
      }
      const entry = answer as Record<string, unknown>;
      if (typeof entry["key"] !== "string" || entry["decision"] === undefined) {
        throw new JevError("BAD_RESPONSE", "Jev returned a malformed answer.");
      }
    }
    return {
      requestId: request.requestId,
      answers: answers as JevDecisionResult<TDecision>["answers"],
      model,
      ...(latencyMs === undefined ? {} : { latencyMs }),
    };
  }
}
