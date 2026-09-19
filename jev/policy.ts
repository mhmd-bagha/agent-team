import {
  Choice,
  ContextDisposition,
  ConvergenceDisposition,
  ExecutionTier,
  ModelTier,
  RiskLevel,
  TEAM_ROLES,
  TeamRole,
  ToolVerdict,
} from "./types.js";

/**
 * Deterministic fallback policy. These rules run when Jev is disabled,
 * unavailable, low-confidence, or overruled — the team works fully without Jev.
 *
 * Precedence (highest first): hard policy > explicit user authorization >
 * deterministic safety checks > Jev decision > LLM suggestion.
 */

// ---------------------------------------------------------------------------
// Routing fallback (mirrors the Tier router in team-run/SKILL.md)
// ---------------------------------------------------------------------------

export function fallbackRole(description: string): TeamRole {
  const text = description.toLowerCase();
  if (/(auth|inject|secret|traversal|ssrf|xss|vuln|exploit)/.test(text)) return "security-reviewer";
  if (/(perf|latency|n\+1|memory leak|slow)/.test(text)) return "performance-reviewer";
  if (/(test|cover|regress|flaky|e2e)/.test(text)) return "test-engineer";
  if (/(review|audit|edge case)/.test(text)) return "reviewer";
  if (/(design|architect|migrat|schema|api contract)/.test(text)) return "architect";
  if (/(research|compare|docs|changelog|which lib)/.test(text)) return "researcher";
  if (/(verify|converge|release|sign-off|final)/.test(text)) return "final-verifier";
  if (/(plan|route|delegate|coordinate|own)/.test(text)) return "team-lead";
  return "implementer";
}

/** Even distribution used when Jev abstains: honest, sums to 1. */
export function evenProbabilities(): Record<TeamRole, number> {
  const share = 1 / TEAM_ROLES.length;
  const out = {} as Record<TeamRole, number>;
  for (const role of TEAM_ROLES) out[role] = share;
  return out;
}

export function fallbackTier(description: string): ExecutionTier {
  const text = description.toLowerCase();
  if (/^(hi|hello|thanks|bye)\b/.test(text) || /(what is|how does|explain|why does)/.test(text)) {
    return "instant";
  }
  if (/(feature|refactor|migrat|multi-file|across|redesign)/.test(text)) return "full";
  if (/(single-file|one-line|typo|off-by-one|small fix)/.test(text)) return "scoped";
  // Deterministic default: escalate ambiguous work to the scoped team rather
  // than answering instantly, so verification evidence is never skipped.
  return "scoped";
}

// ---------------------------------------------------------------------------
// Risk fallback: signal-based, conservative (never downgrades unknown danger)
// ---------------------------------------------------------------------------

export interface RiskSignals {
  readonly touchesCredentials?: boolean;
  readonly destructive?: boolean;
  readonly productionConfig?: boolean;
  readonly databaseMutation?: boolean;
  readonly networkAccess?: boolean;
  readonly shellExecution?: boolean;
  readonly filesystemMutation?: boolean;
  readonly broadRepoChange?: boolean;
  readonly dependencyChange?: boolean;
  readonly authChange?: boolean;
}

export function deterministicRisk(signals: RiskSignals): RiskLevel {
  if (signals.touchesCredentials || signals.destructive) return "CRITICAL";
  if (signals.productionConfig || signals.databaseMutation) return "HIGH";
  if (
    signals.authChange ||
    signals.dependencyChange ||
    (signals.shellExecution === true && signals.networkAccess === true)
  ) {
    return "HIGH";
  }
  if (signals.shellExecution || signals.networkAccess || signals.filesystemMutation) {
    return "MEDIUM";
  }
  if (signals.broadRepoChange) return "MEDIUM";
  return "LOW";
}

// ---------------------------------------------------------------------------
// Tool gate: hard policy first. Jev may only tighten, never loosen.
// ---------------------------------------------------------------------------

export interface ToolAction {
  readonly kind:
    | "shell"
    | "delete"
    | "write"
    | "network"
    | "install"
    | "migrate"
    | "git"
    | "credential";
  readonly destructive?: boolean;
  readonly usesSudo?: boolean;
  readonly userAuthorized?: boolean;
  /** Files touched; used for blast-radius checks. */
  readonly fileCount?: number;
}

/** Hard policy verdict. `null` = policy is silent; Jev may advise. */
export function hardPolicyVerdict(action: ToolAction): ToolVerdict | null {
  // Mirrors config/team-policy.json: allow_sudo=false, allow_destructive_git=false.
  if (action.usesSudo === true) return "BLOCK";
  if (action.kind === "git" && action.destructive === true) return "BLOCK";
  if (action.kind === "delete" && action.destructive === true && !action.userAuthorized) {
    return "BLOCK";
  }
  if (action.kind === "credential" && !action.userAuthorized) return "REVIEW";
  if (action.kind === "migrate" && !action.userAuthorized) return "REVIEW";
  return null;
}

/** Deterministic gate used when Jev is unavailable. */
export function deterministicToolGate(action: ToolAction): ToolVerdict {
  const hard = hardPolicyVerdict(action);
  if (hard !== null) return hard;
  if (action.kind === "shell" || action.kind === "install") return "REVIEW";
  if (action.kind === "write" && (action.fileCount ?? 1) > 10) return "REVIEW";
  if (action.kind === "network") return "REVIEW";
  return "ALLOW";
}

/**
 * Combine: hard policy always wins; otherwise the stricter of deterministic
 * and Jev verdicts wins (order ALLOW < REVIEW < BLOCK).
 */
export function combineToolVerdicts(
  action: ToolAction,
  jevVerdict: ToolVerdict,
): ToolVerdict {
  const hard = hardPolicyVerdict(action);
  if (hard !== null) return hard;
  const rank: Record<ToolVerdict, number> = { ALLOW: 0, REVIEW: 1, BLOCK: 2 };
  const det = deterministicToolGate(action);
  return rank[jevVerdict] >= rank[det] ? jevVerdict : det;
}

// ---------------------------------------------------------------------------
// Convergence: critical/high security findings block regardless of Jev.
// ---------------------------------------------------------------------------

export type FindingSeverity = "critical" | "high" | "medium" | "low";
export type FindingCategory = "security" | "correctness" | "style" | "performance" | "test";

export interface ReviewFinding {
  readonly severity: FindingSeverity;
  readonly category: FindingCategory;
  readonly roundsUsed: number;
  readonly maxRounds: number;
}

export function deterministicConvergence(finding: ReviewFinding): ConvergenceDisposition {
  if (finding.roundsUsed >= finding.maxRounds) return "DEFER";
  if (finding.severity === "critical") return "BLOCK";
  if (finding.severity === "high" && finding.category === "security") return "BLOCK";
  if (finding.severity === "high") return "FIX_NOW";
  if (finding.severity === "medium") return "FIX_NOW";
  return "IGNORE";
}

/**
 * Combine: BLOCK from deterministic policy survives any Jev vote; a Jev BLOCK
 * can additionally stop on findings the rules would fix or ignore.
 */
export function combineConvergence(
  finding: ReviewFinding,
  jevVote: ConvergenceDisposition,
): ConvergenceDisposition {
  const det = deterministicConvergence(finding);
  if (det === "BLOCK") return "BLOCK";
  if (jevVote === "BLOCK") return "BLOCK";
  return det;
}

// ---------------------------------------------------------------------------
// Context compaction: protected kinds are never dropped without explicit policy.
// ---------------------------------------------------------------------------

export const PROTECTED_CONTEXT_KINDS = [
  "acceptance-criteria",
  "requirements",
  "user-constraints",
  "security-findings",
  "unresolved-blockers",
  "verification-evidence",
  "file-ownership",
  "final-test-results",
] as const;

export type ContextKind = (typeof PROTECTED_CONTEXT_KINDS)[number] | "other";

export function guardContextDisposition(
  kind: ContextKind,
  verdict: ContextDisposition,
  explicitPolicyAllowsDrop = false,
): ContextDisposition {
  if (kind === "other") return verdict;
  if (verdict === "DROP" && !explicitPolicyAllowsDrop) return "TRUNCATE";
  return verdict;
}

// ---------------------------------------------------------------------------
// Model tier fallback (logical tiers; provider config resolves the model).
// ---------------------------------------------------------------------------

export function fallbackModelTier(complexityScore: number): ModelTier {
  if (complexityScore >= 0.7) return "STRONG";
  if (complexityScore >= 0.35) return "BALANCED";
  return "FAST";
}

/** Type guard for a routing Choice over known team roles. */
export function isRoleChoice(choice: Choice<string>): choice is Choice<string> {
  return (TEAM_ROLES as readonly string[]).includes(choice.selected);
}
