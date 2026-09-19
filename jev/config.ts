import { JevError } from "./errors.js";

/** Per-gate Jev settings. Thresholds are minimum accepted confidence. */
export interface JevGateConfig {
  readonly enabled: boolean;
  readonly threshold: number;
}

export interface JevConfig {
  readonly enabled: boolean;
  readonly endpoint: string;
  readonly model: string;
  /** API key present? The value itself is never stored in logs or reports. */
  readonly hasApiKey: boolean;
  readonly apiKey: string;
  readonly timeoutMs: number;
  readonly defaultConfidenceThreshold: number;
  readonly routing: JevGateConfig;
  readonly riskGate: JevGateConfig;
  readonly toolGate: JevGateConfig;
  readonly verification: JevGateConfig;
}

export interface JevFileConfig {
  readonly enabled?: boolean;
  readonly endpoint?: string;
  readonly model?: string;
  readonly timeoutMs?: number;
  readonly defaultConfidenceThreshold?: number;
  readonly routing?: Partial<JevGateConfig>;
  readonly riskGate?: Partial<JevGateConfig>;
  readonly toolGate?: Partial<JevGateConfig>;
  readonly verification?: Partial<JevGateConfig>;
}

/** Environment overrides. Secrets come from env only — never from the JSON file. */
export interface JevEnv {
  readonly JEV_ENABLED?: string;
  readonly JEV_ENDPOINT?: string;
  readonly JEV_API_KEY?: string;
  readonly JEV_MODEL?: string;
  readonly JEV_TIMEOUT_MS?: string;
}

const DEFAULTS = {
  enabled: true,
  endpoint: "",
  model: "",
  timeoutMs: 1000,
  defaultConfidenceThreshold: 0.95,
  gateThresholds: {
    routing: 0.9,
    riskGate: 0.95,
    toolGate: 0.98,
    verification: 0.95,
  },
} as const;

function parseBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  const v = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(v)) return true;
  if (["0", "false", "no", "off"].includes(v)) return false;
  return fallback;
}

function gate(
  file: Partial<JevGateConfig> | undefined,
  defaultThreshold: number,
): JevGateConfig {
  const threshold = file?.threshold ?? defaultThreshold;
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
    throw new JevError("NOT_CONFIGURED", "Jev gate threshold must be within 0..1.");
  }
  return { enabled: file?.enabled ?? true, threshold };
}

/**
 * Merge file config (from `config/team-policy.json#/jev`) with env overrides.
 * Env wins for endpoint/model/timeout/enabled; the API key comes from env only.
 */
export function loadJevConfig(file: JevFileConfig = {}, env: JevEnv = {}): JevConfig {
  const timeoutMs = Number(env.JEV_TIMEOUT_MS ?? file.timeoutMs ?? DEFAULTS.timeoutMs);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new JevError("NOT_CONFIGURED", "Jev timeoutMs must be a positive number.");
  }
  const defaultConfidenceThreshold =
    file.defaultConfidenceThreshold ?? DEFAULTS.defaultConfidenceThreshold;
  if (
    !Number.isFinite(defaultConfidenceThreshold) ||
    defaultConfidenceThreshold < 0 ||
    defaultConfidenceThreshold > 1
  ) {
    throw new JevError("NOT_CONFIGURED", "Jev defaultConfidenceThreshold must be within 0..1.");
  }
  const apiKey = env.JEV_API_KEY ?? "";
  return {
    enabled: parseBool(env.JEV_ENABLED, file.enabled ?? DEFAULTS.enabled),
    endpoint: env.JEV_ENDPOINT ?? file.endpoint ?? DEFAULTS.endpoint,
    model: env.JEV_MODEL ?? file.model ?? DEFAULTS.model,
    hasApiKey: apiKey.length > 0,
    apiKey,
    timeoutMs,
    defaultConfidenceThreshold,
    routing: gate(file.routing, DEFAULTS.gateThresholds.routing),
    riskGate: gate(file.riskGate, DEFAULTS.gateThresholds.riskGate),
    toolGate: gate(file.toolGate, DEFAULTS.gateThresholds.toolGate),
    verification: gate(file.verification, DEFAULTS.gateThresholds.verification),
  };
}

/** Readiness for live calls: enabled + endpoint + model + key. */
export function jevReady(config: JevConfig): { ready: boolean; reason: string } {
  if (!config.enabled) return { ready: false, reason: "disabled (JEV_ENABLED=false)" };
  if (!config.endpoint) return { ready: false, reason: "endpoint not configured" };
  if (!config.model) return { ready: false, reason: "model not configured" };
  if (!config.hasApiKey) return { ready: false, reason: "API key not configured" };
  return { ready: true, reason: "ready" };
}

/** Diagnostics-safe snapshot: never includes the API key value. */
export function jevDoctorSnapshot(config: JevConfig): {
  enabled: boolean;
  endpointConfigured: boolean;
  modelConfigured: boolean;
  apiKeyConfigured: boolean;
  timeoutMs: number;
} {
  return {
    enabled: config.enabled,
    endpointConfigured: config.endpoint.length > 0,
    modelConfigured: config.model.length > 0,
    apiKeyConfigured: config.hasApiKey,
    timeoutMs: config.timeoutMs,
  };
}
