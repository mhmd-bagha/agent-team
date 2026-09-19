export { HttpJevClient } from "./client.js";
export type { JevClient, JevClientOptions } from "./client.js";
export { JevDecisions } from "./decisions.js";
export type {
  ConvergenceResult,
  RiskResult,
  RouteResult,
  TierResult,
  ToolGateResult,
} from "./decisions.js";
export { JevError } from "./errors.js";
export type { JevErrorCode } from "./errors.js";
export { FakeJevClient, FailingJevClient } from "./fake.js";
export { loadJevConfig, jevReady, jevDoctorSnapshot } from "./config.js";
export type { JevConfig, JevFileConfig, JevEnv, JevGateConfig } from "./config.js";
export {
  combineConvergence,
  combineToolVerdicts,
  deterministicConvergence,
  deterministicRisk,
  deterministicToolGate,
  fallbackModelTier,
  fallbackRole,
  fallbackTier,
  guardContextDisposition,
  hardPolicyVerdict,
  PROTECTED_CONTEXT_KINDS,
} from "./policy.js";
export type {
  ContextKind,
  FindingCategory,
  FindingSeverity,
  ReviewFinding,
  RiskSignals,
  ToolAction,
} from "./policy.js";
export { JevTelemetry } from "./telemetry.js";
export type { JevDecisionRecord, JevTelemetrySummary } from "./telemetry.js";
export { parseChoice, parseNoul, parseScore, TEAM_ROLES } from "./types.js";
export type {
  Choice,
  ContextDisposition,
  ConvergenceDisposition,
  ExecutionTier,
  JevAnswer,
  JevDecision,
  JevDecisionRequest,
  JevDecisionResult,
  JevQuestion,
  ModelTier,
  Noul,
  RiskLevel,
  Score,
  TeamRole,
  ToolVerdict,
} from "./types.js";
