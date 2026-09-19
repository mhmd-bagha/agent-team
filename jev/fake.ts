import { JevClient } from "./client.js";
import {
  Choice,
  JevDecision,
  JevDecisionRequest,
  JevDecisionResult,
  JevQuestion,
  Noul,
  Score,
  parseChoice,
  parseNoul,
  parseScore,
} from "./types.js";

/**
 * Deterministic fake Jev client for tests and offline development.
 * Returns scripted decisions per question key; falls back to a safe default
 * (first option / 0.5 / abstain) when no script exists. Never needs a key.
 */

type Scripted = Choice<string> | Score | Noul;

function defaultFor(question: JevQuestion<JevDecision>): Scripted {
  if (question.type === "choice") {
    const first = question.options?.[0] ?? "unknown";
    const probabilities: Record<string, number> = {};
    for (const opt of question.options ?? [first]) probabilities[opt] = opt === first ? 1 : 0;
    return { kind: "choice", selected: first, probabilities, confidence: 1 };
  }
  if (question.type === "score") return { kind: "score", value: 0.5, confidence: 1 };
  return { kind: "noul", value: null, confidence: 0 };
}

function coerce(question: JevQuestion<JevDecision>, scripted: Scripted): JevDecision {
  if (question.type === "choice") {
    const parsed = parseChoice(scripted, question.options ?? []);
    if (parsed) return parsed as JevDecision;
    return defaultFor(question) as JevDecision;
  }
  if (question.type === "score") {
    const parsed = scripted.kind === "score" ? parseScore(scripted) : null;
    return (parsed ?? defaultFor(question)) as JevDecision;
  }
  const parsed = scripted.kind === "noul" ? parseNoul(scripted) : null;
  return (parsed ?? defaultFor(question)) as JevDecision;
}

export class FakeJevClient implements JevClient {
  private readonly script: Readonly<Record<string, Scripted>>;
  readonly calls: JevDecisionRequest[] = [];

  constructor(script: Readonly<Record<string, Scripted>> = {}) {
    this.script = script;
  }

  async decide<TDecision extends JevDecision>(
    request: JevDecisionRequest<TDecision>,
  ): Promise<JevDecisionResult<TDecision>> {
    this.calls.push(request as JevDecisionRequest);
    return {
      requestId: request.requestId,
      model: "fake-jev",
      latencyMs: 0,
      answers: request.questions.map((q) => ({
        key: q.key,
        decision: coerce(
          q as JevQuestion<JevDecision>,
          this.script[q.key] ?? defaultFor(q as JevQuestion<JevDecision>),
        ) as TDecision,
      })),
    };
  }
}

/** Failing fake: simulates timeout/unavailability to exercise fallbacks. */
export class FailingJevClient implements JevClient {
  constructor(private readonly code: "TIMEOUT" | "NETWORK" = "TIMEOUT") {}
  async decide<TDecision extends JevDecision>(): Promise<JevDecisionResult<TDecision>> {
    const { JevError } = await import("./errors.js");
    throw new JevError(this.code, `Fake Jev ${this.code.toLowerCase()} failure.`, true);
  }
}
