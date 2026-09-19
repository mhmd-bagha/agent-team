import { JevClient } from "./client.js";
import { JevConfig, jevReady } from "./config.js";
import { JevError } from "./errors.js";
import {
  combineConvergence,
  combineToolVerdicts,
  ContextKind,
  deterministicConvergence,
  deterministicRisk,
  deterministicToolGate,
  fallbackModelTier,
  fallbackRole,
  fallbackTier,
  FindingSeverity,
  guardContextDisposition,
  hardPolicyVerdict,
  isRoleChoice,
  evenProbabilities,
  ReviewFinding,
  RiskSignals,
  ToolAction,
} from "./policy.js";
import {
  Choice,
  ContextDisposition,
  ConvergenceDisposition,
  ExecutionTier,
  JevDecisionRequest,
  ModelTier,
  Noul,
  RiskLevel,
  Score,
  TEAM_ROLES,
  TeamRole,
  ToolVerdict,
  parseChoice,
  parseNoul,
  parseScore,
} from "./types.js";
import { JevTelemetry } from "./telemetry.js";

export interface RouteResult {
  readonly role: TeamRole;
  readonly probabilities: Readonly<Record<TeamRole, number>>;
  readonly confidence: number;
  readonly fallbackUsed: boolean;
  readonly fallbackReason?: string;
}

export interface TierResult {
  readonly tier: ExecutionTier;
  readonly confidence: number;
  readonly fallbackUsed: boolean;
  readonly fallbackReason?: string;
}

export interface RiskResult {
  readonly level: RiskLevel;
  readonly confidence: number;
  readonly fallbackUsed: boolean;
  readonly fallbackReason?: string;
}

export interface ToolGateResult {
  readonly verdict: ToolVerdict;
  readonly confidence: number;
  readonly fallbackUsed: boolean;
  readonly fallbackReason?: string;
}

export interface ConvergenceResult {
  readonly disposition: ConvergenceDisposition;
  readonly fallbackUsed: boolean;
  readonly fallbackReason?: string;
}

const RISK_OPTIONS = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
const TIER_OPTIONS = ["instant", "scoped", "full"] as const;
const TOOL_OPTIONS = ["ALLOW", "REVIEW", "BLOCK"] as const;
const CONTEXT_OPTIONS = ["KEEP", "TRUNCATE", "DROP"] as const;
const CONVERGENCE_OPTIONS = ["IGNORE", "FIX_NOW", "DEFER", "BLOCK"] as const;
const MODEL_OPTIONS = ["FAST", "BALANCED", "STRONG"] as const;

let requestCounter = 0;
function nextRequestId(caller: string): string {
  requestCounter += 1;
  return `${caller}-${Date.now()}-${requestCounter}`;
}

export interface JevDecisionsOptions {
  readonly client: JevClient;
  readonly config: JevConfig;
  readonly telemetry?: JevTelemetry;
  readonly log?: (event: string, fields: Record<string, string | number>) => void;
  readonly maxConvergenceRounds?: number;
}

/**
 * Reusable decision orchestrator. Thin, typed, provider-neutral:
 * every method returns a structured decision + confidence + fallback info,
 * and deterministic policy always overrules Jev (see `policy.ts`).
 */
export class JevDecisions {
  private readonly client: JevClient;
  private readonly config: JevConfig;
  private readonly telemetry: JevTelemetry;
  private readonly log:
    | ((event: string, fields: Record<string, string | number>) => void)
    | undefined;
  private readonly maxRounds: number;

  constructor(options: JevDecisionsOptions) {
    this.client = options.client;
    this.config = options.config;
    this.telemetry = options.telemetry ?? new JevTelemetry();
    this.log = options.log;
    this.maxRounds = options.maxConvergenceRounds ?? 8;
  }

  get telemetrySnapshot(): JevTelemetry {
    return this.telemetry;
  }

  // -- internal helpers -----------------------------------------------------

  private gateEnabled(gate: "routing" | "riskGate" | "toolGate" | "verification"): boolean {
    return this.config.enabled && this.config[gate].enabled;
  }

  private async askSingle(
    caller: string,
    key: string,
    type: "choice" | "score" | "noul",
    options: readonly string[] | undefined,
    context: Readonly<Record<string, string | number | boolean>> | undefined,
  ): Promise<{ raw: unknown; latencyMs: number; model: string }> {
    const started = Date.now();
    const request: JevDecisionRequest = {
      requestId: nextRequestId(caller),
      caller,
      questions: [
        {
          key,
          type,
          ...(options === undefined ? {} : { options }),
          ...(context === undefined ? {} : { context }),
        },
      ],
    };
    const result = await this.client.decide(request);
    const answer = result.answers[0];
    if (!answer || answer.key !== key) {
      throw new JevError("BAD_RESPONSE", `Jev answer key mismatch for "${key}".`);
    }
    return {
      raw: answer.decision,
      latencyMs: Date.now() - started,
      model: result.model,
    };
  }

  /**
   * Batch several independent questions sharing one state into a single call
   * (§22: prefer one state + many questions over sequential calls).
   */
  async decideBatch(
    caller: string,
    questions: {
      readonly key: string;
      readonly type: "choice" | "score" | "noul";
      readonly options?: readonly string[];
    }[],
    context?: Readonly<Record<string, string | number | boolean>>,
  ): Promise<Readonly<Record<string, unknown>>> {
    const request: JevDecisionRequest = {
      requestId: nextRequestId(caller),
      caller,
      questions: questions.map((q) => ({
        key: q.key,
        type: q.type,
        ...(q.options === undefined ? {} : { options: q.options }),
        ...(context === undefined ? {} : { context }),
      })),
    };
    const result = await this.client.decide(request);
    const out: Record<string, unknown> = {};
    for (const answer of result.answers) out[answer.key] = answer.decision;
    return out;
  }

  private observe(
    decisionType: string,
    decision: string,
    confidence: number,
    latencyMs: number,
    model: string,
    caller: string,
    fallbackUsed: boolean,
    fallbackReason?: string,
    taskId?: string,
  ): void {
    this.telemetry.emit(
      this.log ?? (() => undefined),
      {
        decisionType,
        decision,
        confidence,
        latencyMs,
        model,
        caller,
        phase: caller,
        ...(taskId === undefined ? {} : { taskId }),
        fallbackUsed,
        ...(fallbackReason === undefined ? {} : { fallbackReason }),
      },
    );
  }

  // -- routing ---------------------------------------------------------------

  async route(description: string, taskId?: string): Promise<RouteResult> {
    const caller = "routing";
    const fallback = (reason: string): RouteResult => {
      const role = fallbackRole(description);
      const probs = evenProbabilities();
      probs[role] = 0.6;
      const rest = 0.4 / (TEAM_ROLES.length - 1);
      for (const r of TEAM_ROLES) if (r !== role) probs[r] = rest;
      this.observe("route", role, 0.6, 0, "deterministic", caller, true, reason, taskId);
      return { role, probabilities: probs, confidence: 0.6, fallbackUsed: true, fallbackReason: reason };
    };
    if (!this.gateEnabled("routing")) return fallback("disabled");
    if (!jevReady(this.config).ready) return fallback("not-configured");
    try {
      const { raw, latencyMs, model } = await this.askSingle(caller, "route", "choice", TEAM_ROLES, {
        task: description.slice(0, 500),
      });
      const parsed: Choice<string> | null = parseChoice(raw, TEAM_ROLES);
      if (!parsed || !isRoleChoice(parsed)) {
        this.observe("route", "fallback", 0, latencyMs, model, caller, true, "invalid-decision", taskId);
        return fallback("invalid-decision");
      }
      if (parsed.confidence < this.config.routing.threshold) {
        this.observe("route", parsed.selected, parsed.confidence, latencyMs, model, caller, true, "below-threshold", taskId);
        return fallback("below-threshold");
      }
      const probs = evenProbabilities();
      for (const r of TEAM_ROLES) probs[r] = parsed.probabilities[r] ?? 0;
      this.observe("route", parsed.selected, parsed.confidence, latencyMs, model, caller, false, undefined, taskId);
      return {
        role: parsed.selected as TeamRole,
        probabilities: probs,
        confidence: parsed.confidence,
        fallbackUsed: false,
      };
    } catch {
      return fallback("error");
    }
  }

  // -- execution tier ----------------------------------------------------------

  async selectTier(
    description: string,
    signals?: { readonly affectedFiles?: number; readonly blastRadius?: string },
    taskId?: string,
  ): Promise<TierResult> {
    const caller = "tier";
    const fallback = (reason: string): TierResult => {
      const tier = fallbackTier(description);
      this.observe("tier", tier, 0.6, 0, "deterministic", caller, true, reason, taskId);
      return { tier, confidence: 0.6, fallbackUsed: true, fallbackReason: reason };
    };
    // Deterministic guard: clearly huge changes never go instant.
    if ((signals?.affectedFiles ?? 1) > 10) {
      this.observe("tier", "full", 1, 0, "deterministic", caller, true, "policy-override", taskId);
      return { tier: "full", confidence: 1, fallbackUsed: true, fallbackReason: "policy-override" };
    }
    if (!this.gateEnabled("routing")) return fallback("disabled");
    if (!jevReady(this.config).ready) return fallback("not-configured");
    try {
      const { raw, latencyMs, model } = await this.askSingle(caller, "tier", "choice", TIER_OPTIONS, {
        task: description.slice(0, 500),
        affectedFiles: signals?.affectedFiles ?? 1,
      });
      const parsed = parseChoice(raw, TIER_OPTIONS);
      if (!parsed) {
        this.observe("tier", "fallback", 0, latencyMs, model, caller, true, "invalid-decision", taskId);
        return fallback("invalid-decision");
      }
      if (parsed.confidence < this.config.routing.threshold) {
        this.observe("tier", parsed.selected, parsed.confidence, latencyMs, model, caller, true, "below-threshold", taskId);
        return fallback("below-threshold");
      }
      // Deterministic control survives: a single-file request never escalates
      // to full team on Jev's word alone when signals say scoped.
      let tier = parsed.selected as ExecutionTier;
      if (tier === "instant" && (signals?.affectedFiles ?? 1) > 1) tier = "scoped";
      this.observe("tier", tier, parsed.confidence, latencyMs, model, caller, false, undefined, taskId);
      return { tier, confidence: parsed.confidence, fallbackUsed: false };
    } catch {
      return fallback("error");
    }
  }

  // -- risk --------------------------------------------------------------------

  async classifyRisk(signals: RiskSignals, taskId?: string): Promise<RiskResult> {
    const caller = "risk";
    const det = deterministicRisk(signals);
    if (!this.gateEnabled("riskGate")) {
      this.observe("risk", det, 0.8, 0, "deterministic", caller, true, "disabled", taskId);
      return { level: det, confidence: 0.8, fallbackUsed: true, fallbackReason: "disabled" };
    }
    if (!jevReady(this.config).ready) {
      this.observe("risk", det, 0.8, 0, "deterministic", caller, true, "not-configured", taskId);
      return { level: det, confidence: 0.8, fallbackUsed: true, fallbackReason: "not-configured" };
    }
    try {
      const context: Record<string, string | number | boolean> = {};
      for (const [k, v] of Object.entries(signals)) context[k] = v ?? false;
      const { raw, latencyMs, model } = await this.askSingle(caller, "risk", "choice", RISK_OPTIONS, context);
      const parsed = parseChoice(raw, RISK_OPTIONS);
      if (!parsed) {
        this.observe("risk", det, 0.8, latencyMs, model, caller, true, "invalid-decision", taskId);
        return { level: det, confidence: 0.8, fallbackUsed: true, fallbackReason: "invalid-decision" };
      }
      const jevLevel = parsed.selected as RiskLevel;
      // Jev may only escalate, never de-escalate below deterministic risk.
      const order: Record<RiskLevel, number> = { LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 };
      const level = order[jevLevel] >= order[det] ? jevLevel : det;
      const overridden = level !== jevLevel ? "policy-override" : undefined;
      if (parsed.confidence < this.config.riskGate.threshold) {
        this.observe("risk", det, parsed.confidence, latencyMs, model, caller, true, "below-threshold", taskId);
        return { level: det, confidence: parsed.confidence, fallbackUsed: true, fallbackReason: "below-threshold" };
      }
      this.observe("risk", level, parsed.confidence, latencyMs, model, caller, overridden !== undefined, overridden, taskId);
      return {
        level,
        confidence: parsed.confidence,
        fallbackUsed: overridden !== undefined,
        ...(overridden === undefined ? {} : { fallbackReason: overridden }),
      };
    } catch {
      this.observe("risk", det, 0.8, 0, "deterministic", caller, true, "error", taskId);
      return { level: det, confidence: 0.8, fallbackUsed: true, fallbackReason: "error" };
    }
  }

  // -- tool gate -----------------------------------------------------------------

  async approveTool(action: ToolAction, taskId?: string): Promise<ToolGateResult> {
    const caller = "tool-gate";
    const hard = hardPolicyVerdict(action);
    if (hard !== null) {
      // Hard policy short-circuits: no Jev call (saves latency, cannot bypass).
      this.observe("tool-gate", hard, 1, 0, "deterministic", caller, true, "policy-override", taskId);
      return { verdict: hard, confidence: 1, fallbackUsed: true, fallbackReason: "policy-override" };
    }
    const det = deterministicToolGate(action);
    if (!this.gateEnabled("toolGate")) {
      this.observe("tool-gate", det, 0.8, 0, "deterministic", caller, true, "disabled", taskId);
      return { verdict: det, confidence: 0.8, fallbackUsed: true, fallbackReason: "disabled" };
    }
    if (!jevReady(this.config).ready) {
      this.observe("tool-gate", det, 0.8, 0, "deterministic", caller, true, "not-configured", taskId);
      return { verdict: det, confidence: 0.8, fallbackUsed: true, fallbackReason: "not-configured" };
    }
    try {
      const { raw, latencyMs, model } = await this.askSingle(caller, "tool-gate", "choice", TOOL_OPTIONS, {
        action: action.kind,
        destructive: action.destructive ?? false,
      });
      const parsed = parseChoice(raw, TOOL_OPTIONS);
      if (!parsed) {
        this.observe("tool-gate", det, 0.8, latencyMs, model, caller, true, "invalid-decision", taskId);
        return { verdict: det, confidence: 0.8, fallbackUsed: true, fallbackReason: "invalid-decision" };
      }
      if (parsed.confidence < this.config.toolGate.threshold) {
        this.observe("tool-gate", det, parsed.confidence, latencyMs, model, caller, true, "below-threshold", taskId);
        return { verdict: det, confidence: parsed.confidence, fallbackUsed: true, fallbackReason: "below-threshold" };
      }
      const verdict = combineToolVerdicts(action, parsed.selected as ToolVerdict);
      const overridden = verdict !== parsed.selected ? "policy-override" : undefined;
      this.observe("tool-gate", verdict, parsed.confidence, latencyMs, model, caller, overridden !== undefined, overridden, taskId);
      return {
        verdict,
        confidence: parsed.confidence,
        fallbackUsed: overridden !== undefined,
        ...(overridden === undefined ? {} : { fallbackReason: overridden }),
      };
    } catch {
      this.observe("tool-gate", det, 0.8, 0, "deterministic", caller, true, "error", taskId);
      return { verdict: det, confidence: 0.8, fallbackUsed: true, fallbackReason: "error" };
    }
  }

  // -- context compaction ----------------------------------------------------------

  async compactContext(
    kind: ContextKind,
    summary: string,
    taskId?: string,
  ): Promise<{ disposition: ContextDisposition; fallbackUsed: boolean; fallbackReason?: string }> {
    const caller = "context";
    const fallbackTo = (
      disposition: ContextDisposition,
      reason: string,
    ): { disposition: ContextDisposition; fallbackUsed: boolean; fallbackReason?: string } => {
      const guarded = guardContextDisposition(kind, disposition);
      this.observe("context", guarded, 0.7, 0, "deterministic", caller, true, reason, taskId);
      return { disposition: guarded, fallbackUsed: true, fallbackReason: reason };
    };
    if (!this.config.enabled) return fallbackTo("KEEP", "disabled");
    if (!jevReady(this.config).ready) return fallbackTo("KEEP", "not-configured");
    try {
      const { raw, latencyMs, model } = await this.askSingle(caller, "context", "choice", CONTEXT_OPTIONS, {
        kind,
        summary: summary.slice(0, 300),
      });
      const parsed = parseChoice(raw, CONTEXT_OPTIONS);
      if (!parsed) return fallbackTo("KEEP", "invalid-decision");
      const guarded = guardContextDisposition(kind, parsed.selected as ContextDisposition);
      const overridden = guarded !== parsed.selected ? "policy-override" : undefined;
      this.observe("context", guarded, parsed.confidence, latencyMs, model, caller, overridden !== undefined, overridden, taskId);
      return {
        disposition: guarded,
        fallbackUsed: overridden !== undefined,
        ...(overridden === undefined ? {} : { fallbackReason: overridden }),
      };
    } catch {
      return fallbackTo("KEEP", "error");
    }
  }

  // -- verification (Noul signals; evidence still mandatory) -------------------------

  async evaluateVerification(
    requirement: string,
    evidence: string,
    taskId?: string,
  ): Promise<{ satisfied: Noul; regressionLikely: Score; readyForFinal: Noul }> {
    const caller = "verification";
    const disabled = !this.gateEnabled("verification") || !jevReady(this.config).ready;
    if (disabled) {
      const abstain: Noul = { kind: "noul", value: null, confidence: 0 };
      return {
        satisfied: abstain,
        regressionLikely: { kind: "score", value: 0.5, confidence: 0 },
        readyForFinal: abstain,
      };
    }
    try {
      const out = await this.decideBatch(
        caller,
        [
          { key: "satisfied", type: "noul" },
          { key: "regressionLikely", type: "score" },
          { key: "readyForFinal", type: "noul" },
        ],
        { requirement: requirement.slice(0, 300), evidence: evidence.slice(0, 300) },
      );
      const satisfied = parseNoul(out["satisfied"]) ?? { kind: "noul", value: null, confidence: 0 } as Noul;
      const regressionLikely = parseScore(out["regressionLikely"]) ?? {
        kind: "score",
        value: 0.5,
        confidence: 0,
      } as Score;
      const readyForFinal = parseNoul(out["readyForFinal"]) ?? { kind: "noul", value: null, confidence: 0 } as Noul;
      this.observe("verification", String(satisfied.value), satisfied.confidence, 0, "jev", caller, false, undefined, taskId);
      return { satisfied, regressionLikely, readyForFinal };
    } catch {
      const abstain: Noul = { kind: "noul", value: null, confidence: 0 };
      return {
        satisfied: abstain,
        regressionLikely: { kind: "score", value: 0.5, confidence: 0 },
        readyForFinal: abstain,
      };
    }
  }

  // -- convergence -------------------------------------------------------------------

  async selectConvergenceAction(
    finding: ReviewFinding & { summary?: string },
    taskId?: string,
  ): Promise<ConvergenceResult> {
    const caller = "convergence";
    const det = deterministicConvergence({
      severity: finding.severity,
      category: finding.category,
      roundsUsed: finding.roundsUsed,
      maxRounds: finding.maxRounds,
    });
    // Max rounds is absolute policy: no Jev call once exhausted.
    if (finding.roundsUsed >= (finding.maxRounds || this.maxRounds)) {
      this.observe("convergence", "DEFER", 1, 0, "deterministic", caller, true, "policy-override", taskId);
      return { disposition: "DEFER", fallbackUsed: true, fallbackReason: "policy-override" };
    }
    if (!this.config.enabled || !jevReady(this.config).ready) {
      this.observe("convergence", det, 0.8, 0, "deterministic", caller, true, "not-configured", taskId);
      return { disposition: det, fallbackUsed: true, fallbackReason: "not-configured" };
    }
    try {
      const { raw, latencyMs, model } = await this.askSingle(
        caller,
        "convergence",
        "choice",
        CONVERGENCE_OPTIONS,
        {
          severity: finding.severity,
          category: finding.category,
          summary: (finding.summary ?? "").slice(0, 300),
        },
      );
      const parsed = parseChoice(raw, CONVERGENCE_OPTIONS);
      if (!parsed) {
        this.observe("convergence", det, 0.8, latencyMs, model, caller, true, "invalid-decision", taskId);
        return { disposition: det, fallbackUsed: true, fallbackReason: "invalid-decision" };
      }
      const disposition = combineConvergence(
        {
          severity: finding.severity as FindingSeverity,
          category: finding.category as ReviewFinding["category"],
          roundsUsed: finding.roundsUsed,
          maxRounds: finding.maxRounds,
        },
        parsed.selected as ConvergenceDisposition,
      );
      const overridden = disposition !== parsed.selected ? "policy-override" : undefined;
      this.observe("convergence", disposition, parsed.confidence, latencyMs, model, caller, overridden !== undefined, overridden, taskId);
      return {
        disposition,
        fallbackUsed: overridden !== undefined,
        ...(overridden === undefined ? {} : { fallbackReason: overridden }),
      };
    } catch {
      this.observe("convergence", det, 0.8, 0, "deterministic", caller, true, "error", taskId);
      return { disposition: det, fallbackUsed: true, fallbackReason: "error" };
    }
  }

  // -- model tier ----------------------------------------------------------------------

  async selectModelTier(complexityScore: number, taskId?: string): Promise<ModelTier> {
    const fallback = fallbackModelTier(complexityScore);
    if (!this.config.enabled || !jevReady(this.config).ready) return fallback;
    try {
      const { raw } = await this.askSingle("model-tier", "model-tier", "choice", MODEL_OPTIONS, {
        complexity: complexityScore,
      });
      const parsed = parseChoice(raw, MODEL_OPTIONS);
      if (!parsed || parsed.confidence < this.config.defaultConfidenceThreshold) return fallback;
      return parsed.selected as ModelTier;
    } catch {
      return fallback;
    }
  }
}
