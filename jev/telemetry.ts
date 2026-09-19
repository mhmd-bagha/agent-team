/**
 * Minimal structured telemetry for Jev decisions.
 * Answers §16 questions (route/fallback rates, confidence, latency) from
 * counters + latency samples. Never stores secrets — records carry only
 * decision metadata (see `JevDecisionRecord`).
 */

export interface JevDecisionRecord {
  readonly decisionType: string;
  readonly decision: string;
  readonly confidence: number;
  readonly latencyMs: number;
  readonly model: string;
  readonly caller: string;
  readonly phase: string;
  readonly taskId?: string;
  readonly fallbackUsed: boolean;
  readonly fallbackReason?: string;
}

export interface JevTelemetrySummary {
  readonly total: number;
  readonly byType: Record<string, number>;
  readonly fallbacks: number;
  readonly fallbackRate: number;
  readonly belowThreshold: number;
  readonly policyOverrides: number;
  readonly latencyP50Ms: number;
  readonly latencyP95Ms: number;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  const v = sorted[Math.max(0, idx)];
  return v ?? 0;
}

export class JevTelemetry {
  private readonly records: JevDecisionRecord[] = [];
  private belowThresholdCount = 0;
  private policyOverrideCount = 0;

  record(entry: JevDecisionRecord): void {
    this.records.push(entry);
    if (entry.fallbackUsed && entry.fallbackReason === "below-threshold") {
      this.belowThresholdCount += 1;
    }
    if (entry.fallbackReason === "policy-override") {
      this.policyOverrideCount += 1;
    }
  }

  /** Emit a single JSON line via the host logger (no secrets in records). */
  emit(
    log: (event: string, fields: Record<string, string | number>) => void,
    entry: JevDecisionRecord,
  ): void {
    this.record(entry);
    log("jev.decision", {
      type: entry.decisionType,
      decision: entry.decision,
      confidence: Math.round(entry.confidence * 1000) / 1000,
      latencyMs: Math.round(entry.latencyMs),
      model: entry.model,
      caller: entry.caller,
      phase: entry.phase,
      fallback: entry.fallbackUsed ? 1 : 0,
    });
  }

  summary(): JevTelemetrySummary {
    const byType: Record<string, number> = {};
    let fallbacks = 0;
    const latencies: number[] = [];
    for (const r of this.records) {
      byType[r.decisionType] = (byType[r.decisionType] ?? 0) + 1;
      if (r.fallbackUsed) fallbacks += 1;
      latencies.push(r.latencyMs);
    }
    latencies.sort((a, b) => a - b);
    const total = this.records.length;
    return {
      total,
      byType,
      fallbacks,
      fallbackRate: total === 0 ? 0 : fallbacks / total,
      belowThreshold: this.belowThresholdCount,
      policyOverrides: this.policyOverrideCount,
      latencyP50Ms: percentile(latencies, 50),
      latencyP95Ms: percentile(latencies, 95),
    };
  }
}
