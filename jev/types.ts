/**
 * Jev typed decision primitives.
 *
 * Callers never parse free-form model output: the client returns these
 * structured values directly, and `decisions.ts` validates them.
 */

/** Categorical decision with a full probability distribution. */
export interface Choice<T extends string> {
  readonly kind: "choice";
  /** Selected option. Must be one of `options`. */
  readonly selected: T;
  /** Probability per option; values sum to ~1. */
  readonly probabilities: Readonly<Record<T, number>>;
  /** Model confidence in `selected`, 0..1. */
  readonly confidence: number;
}

/** Scalar judgment, 0..1 (e.g. "how likely is a regression?"). */
export interface Score {
  readonly kind: "score";
  readonly value: number;
  readonly confidence: number;
}

/**
 * Boolean-with-abstention judgment ("Noul" = nullable bool).
 * `null` means the model abstained — treat as insufficient confidence.
 */
export interface Noul {
  readonly kind: "noul";
  readonly value: boolean | null;
  readonly confidence: number;
}

export type JevDecision = Choice<string> | Score | Noul;

/** A single typed question asked of Jev. */
export interface JevQuestion<TDecision extends JevDecision> {
  /** Stable question key, e.g. "route", "risk". */
  readonly key: string;
  /** Discriminator the server uses to shape its answer. */
  readonly type: "choice" | "score" | "noul";
  /** Allowed options for `choice` questions. */
  readonly options?: readonly string[];
  /** Free-form, non-secret context (task summary, signals). Never secrets. */
  readonly context?: Readonly<Record<string, string | number | boolean>>;
}

/** Request envelope: one shared state + one or more typed questions. */
export interface JevDecisionRequest<TDecision extends JevDecision = JevDecision> {
  /** Idempotency / tracing id supplied by the orchestrator. */
  readonly requestId: string;
  /** Caller phase, e.g. "routing", "convergence-round-3". */
  readonly caller: string;
  readonly questions: readonly JevQuestion<TDecision>[];
}

/** Result for one question. */
export interface JevAnswer<TDecision extends JevDecision = JevDecision> {
  readonly key: string;
  readonly decision: TDecision;
}

/** Result envelope returned by the client. */
export interface JevDecisionResult<TDecision extends JevDecision = JevDecision> {
  readonly requestId: string;
  readonly answers: readonly JevAnswer<TDecision>[];
  /** Server-reported model name (logical name, never a secret). */
  readonly model: string;
  /** Server-side latency in ms, when reported. */
  readonly latencyMs?: number;
}

/** Roles defined by this repository (`.claude/agents/*.md`). No new roles. */
export const TEAM_ROLES = [
  "team-lead",
  "architect",
  "researcher",
  "implementer",
  "reviewer",
  "test-engineer",
  "security-reviewer",
  "performance-reviewer",
  "final-verifier",
] as const;

export type TeamRole = (typeof TEAM_ROLES)[number];

/** Execution tiers from the team protocol (Tier 0 instant / 1 scoped / 2 full). */
export type ExecutionTier = "instant" | "scoped" | "full";

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export type ToolVerdict = "ALLOW" | "REVIEW" | "BLOCK";

export type ContextDisposition = "KEEP" | "TRUNCATE" | "DROP";

export type ConvergenceDisposition = "IGNORE" | "FIX_NOW" | "DEFER" | "BLOCK";

/** Logical capability tier; provider config resolves the actual model. */
export type ModelTier = "FAST" | "BALANCED" | "STRONG";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Narrow an unknown payload to a valid Choice over the given options. */
export function parseChoice(
  value: unknown,
  options: readonly string[],
): Choice<string> | null {
  if (!isRecord(value)) return null;
  const { selected, probabilities, confidence } = value;
  if (typeof selected !== "string" || !options.includes(selected)) return null;
  if (!isRecord(probabilities) || !isNumber(confidence)) return null;
  if (confidence < 0 || confidence > 1) return null;
  const probs: Record<string, number> = {};
  for (const opt of options) {
    const p = probabilities[opt];
    if (!isNumber(p) || p < 0 || p > 1) return null;
    probs[opt] = p;
  }
  return {
    kind: "choice",
    selected,
    probabilities: probs,
    confidence,
  };
}

/** Narrow an unknown payload to a valid Score. */
export function parseScore(value: unknown): Score | null {
  if (!isRecord(value)) return null;
  const { value: v, confidence } = value;
  if (!isNumber(v) || v < 0 || v > 1) return null;
  if (!isNumber(confidence) || confidence < 0 || confidence > 1) return null;
  return { kind: "score", value: v, confidence };
}

/** Narrow an unknown payload to a valid Noul. */
export function parseNoul(value: unknown): Noul | null {
  if (!isRecord(value)) return null;
  const { value: v, confidence } = value;
  if (v !== null && typeof v !== "boolean") return null;
  if (!isNumber(confidence) || confidence < 0 || confidence > 1) return null;
  return { kind: "noul", value: v, confidence };
}
