import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { loadJevConfig } from "./config.js";
import { JevDecisions } from "./decisions.js";
import { FakeJevClient, FailingJevClient } from "./fake.js";
import { JevTelemetry } from "./telemetry.js";
import { TEAM_ROLES } from "./types.js";

function liveConfig() {
  return loadJevConfig(
    {},
    { JEV_ENDPOINT: "https://jev.example", JEV_MODEL: "m", JEV_API_KEY: "k" },
  );
}

function probs(selected: string, confidence: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of TEAM_ROLES) out[r] = r === selected ? confidence : (1 - confidence) / (TEAM_ROLES.length - 1);
  return out;
}

describe("routing", () => {
  it("routes high-confidence decisions to the selected role", async () => {
    const client = new FakeJevClient({
      route: { kind: "choice", selected: "implementer", probabilities: probs("implementer", 0.95), confidence: 0.95 },
    });
    const d = new JevDecisions({ client, config: liveConfig() });
    const result = await d.route("add CSV export to orders table");
    assert.equal(result.role, "implementer");
    assert.equal(result.fallbackUsed, false);
    assert.equal(result.confidence, 0.95);
  });

  it("falls back to team-lead/deterministic rule below threshold", async () => {
    const client = new FakeJevClient({
      route: { kind: "choice", selected: "implementer", probabilities: probs("implementer", 0.4), confidence: 0.4 },
    });
    const d = new JevDecisions({ client, config: liveConfig() });
    const result = await d.route("migrate the auth schema");
    assert.equal(result.fallbackUsed, true);
    assert.equal(result.fallbackReason, "below-threshold");
    // Deterministic rule sees "auth" -> security-reviewer (security first).
    assert.equal(result.role, "security-reviewer");
  });

  it("falls back when Jev is unavailable", async () => {
    const d = new JevDecisions({ client: new FailingJevClient(), config: liveConfig() });
    const result = await d.route("fix the off-by-one in sum.js");
    assert.equal(result.fallbackUsed, true);
    assert.equal(result.role, "implementer");
  });

  it("deterministic override: huge change never goes instant", async () => {
    const client = new FakeJevClient({
      tier: { kind: "choice", selected: "instant", probabilities: { instant: 0.99, scoped: 0.01, full: 0 }, confidence: 0.99 },
    });
    const d = new JevDecisions({ client, config: liveConfig() });
    const result = await d.selectTier("rewrite everything", { affectedFiles: 50 });
    assert.equal(result.tier, "full");
    assert.equal(result.fallbackReason, "policy-override");
  });

  it("works fully disabled (JEV_ENABLED=false)", async () => {
    const config = loadJevConfig({}, { JEV_ENABLED: "false" });
    const d = new JevDecisions({ client: new FailingJevClient(), config });
    const routed = await d.route("add CSV export");
    assert.equal(routed.fallbackUsed, true);
    const tier = await d.selectTier("fix typo");
    assert.equal(tier.fallbackUsed, true);
  });
});

describe("risk + tool gate", () => {
  it("classifies low-risk actions as LOW", async () => {
    const client = new FakeJevClient({
      risk: { kind: "choice", selected: "LOW", probabilities: { LOW: 0.97, MEDIUM: 0.02, HIGH: 0.005, CRITICAL: 0.005 }, confidence: 0.97 },
    });
    const d = new JevDecisions({ client, config: liveConfig() });
    const result = await d.classifyRisk({});
    assert.equal(result.level, "LOW");
    assert.equal(result.fallbackUsed, false);
  });

  it("never de-escalates below deterministic risk", async () => {
    const client = new FakeJevClient({
      risk: { kind: "choice", selected: "LOW", probabilities: { LOW: 0.99, MEDIUM: 0.01, HIGH: 0, CRITICAL: 0 }, confidence: 0.99 },
    });
    const d = new JevDecisions({ client, config: liveConfig() });
    const result = await d.classifyRisk({ touchesCredentials: true });
    assert.equal(result.level, "CRITICAL");
    assert.equal(result.fallbackReason, "policy-override");
  });

  it("hard policy blocks sudo even when Jev allows", async () => {
    const client = new FakeJevClient({
      "tool-gate": { kind: "choice", selected: "ALLOW", probabilities: { ALLOW: 0.99, REVIEW: 0.01, BLOCK: 0 }, confidence: 0.99 },
    });
    const d = new JevDecisions({ client, config: liveConfig() });
    const result = await d.approveTool({ kind: "shell", usesSudo: true });
    assert.equal(result.verdict, "BLOCK");
    // No Jev call should have been made: hard policy short-circuits.
    assert.equal(client.calls.length, 0);
  });

  it("tool gate allows safe reads and reviews installs", async () => {
    const allowClient = new FakeJevClient({
      "tool-gate": { kind: "choice", selected: "ALLOW", probabilities: { ALLOW: 0.99, REVIEW: 0.005, BLOCK: 0.005 }, confidence: 0.99 },
    });
    const d = new JevDecisions({ client: allowClient, config: liveConfig() });
    const write = await d.approveTool({ kind: "write", fileCount: 1 });
    assert.equal(write.verdict, "ALLOW");

    const reviewClient = new FakeJevClient({
      "tool-gate": { kind: "choice", selected: "ALLOW", probabilities: { ALLOW: 0.99, REVIEW: 0.01, BLOCK: 0 }, confidence: 0.99 },
    });
    const d2 = new JevDecisions({ client: reviewClient, config: liveConfig() });
    // Deterministic REVIEW for installs survives a Jev ALLOW (stricter wins).
    const install = await d2.approveTool({ kind: "install" });
    assert.equal(install.verdict, "REVIEW");
  });
});

describe("convergence", () => {
  it("fixes medium findings and defers at max rounds", async () => {
    const client = new FakeJevClient({
      convergence: { kind: "choice", selected: "FIX_NOW", probabilities: { IGNORE: 0, FIX_NOW: 0.96, DEFER: 0.03, BLOCK: 0.01 }, confidence: 0.96 },
    });
    const d = new JevDecisions({ client, config: liveConfig(), maxConvergenceRounds: 8 });
    const fix = await d.selectConvergenceAction({ severity: "medium", category: "correctness", roundsUsed: 1, maxRounds: 8 });
    assert.equal(fix.disposition, "FIX_NOW");

    const exhausted = await d.selectConvergenceAction({ severity: "medium", category: "correctness", roundsUsed: 8, maxRounds: 8 });
    assert.equal(exhausted.disposition, "DEFER");
  });

  it("critical findings block regardless of Jev vote", async () => {
    const client = new FakeJevClient({
      convergence: { kind: "choice", selected: "IGNORE", probabilities: { IGNORE: 0.9, FIX_NOW: 0.05, DEFER: 0.04, BLOCK: 0.01 }, confidence: 0.9 },
    });
    const d = new JevDecisions({ client, config: liveConfig() });
    const result = await d.selectConvergenceAction({ severity: "critical", category: "security", roundsUsed: 0, maxRounds: 8 });
    assert.equal(result.disposition, "BLOCK");
  });

  it("falls back deterministically when Jev is down", async () => {
    const d = new JevDecisions({ client: new FailingJevClient(), config: liveConfig() });
    const result = await d.selectConvergenceAction({ severity: "low", category: "style", roundsUsed: 0, maxRounds: 8 });
    assert.equal(result.disposition, "IGNORE");
    assert.equal(result.fallbackUsed, true);
  });
});

describe("context + verification + model tier", () => {
  it("keeps protected context and drops trivia", async () => {
    const client = new FakeJevClient({
      context: { kind: "choice", selected: "DROP", probabilities: { KEEP: 0.01, TRUNCATE: 0.02, DROP: 0.97 }, confidence: 0.97 },
    });
    const d = new JevDecisions({ client, config: liveConfig() });
    const prot = await d.compactContext("acceptance-criteria", "must preserve ?next= through SSO");
    assert.equal(prot.disposition, "TRUNCATE");
    const trivia = await d.compactContext("other", "stale tool listing");
    assert.equal(trivia.disposition, "DROP");
  });

  it("batches verification signals in one call", async () => {
    const client = new FakeJevClient({
      satisfied: { kind: "noul", value: true, confidence: 0.96 },
      regressionLikely: { kind: "score", value: 0.1, confidence: 0.9 },
      readyForFinal: { kind: "noul", value: true, confidence: 0.93 },
    });
    const d = new JevDecisions({ client, config: liveConfig() });
    const v = await d.evaluateVerification("preserve ?next=", "auth/redirect tests 14/14 pass");
    assert.equal(v.satisfied.value, true);
    assert.equal(v.readyForFinal.value, true);
    assert.equal(client.calls.length, 1);
    assert.equal(client.calls[0]?.questions.length, 3);
  });

  it("selects logical model tiers with fallback", async () => {
    const client = new FakeJevClient({
      "model-tier": { kind: "choice", selected: "STRONG", probabilities: { FAST: 0.05, BALANCED: 0.05, STRONG: 0.9 }, confidence: 0.9 },
    });
    const d = new JevDecisions({ client, config: liveConfig() });
    // Below default 0.95 threshold -> deterministic fallback by complexity.
    assert.equal(await d.selectModelTier(0.9), "STRONG");
    assert.equal(await d.selectModelTier(0.1), "FAST");
  });
});

describe("telemetry", () => {
  it("records decisions and summarizes fallback/latency", async () => {
    const telemetry = new JevTelemetry();
    const client = new FakeJevClient({
      route: { kind: "choice", selected: "implementer", probabilities: probs("implementer", 0.95), confidence: 0.95 },
    });
    const d = new JevDecisions({ client, config: liveConfig(), telemetry, log: () => undefined });
    await d.route("fix typo");
    await d.route("fix typo");
    const summary = telemetry.summary();
    assert.equal(summary.total, 2);
    assert.equal(summary.byType["route"], 2);
    assert.ok(summary.latencyP50Ms >= 0);
  });
});
