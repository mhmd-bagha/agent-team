import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { loadJevConfig, jevReady, jevDoctorSnapshot } from "./config.js";
import { JevError } from "./errors.js";

describe("loadJevConfig", () => {
  it("applies defaults with nothing configured", () => {
    const config = loadJevConfig({}, {});
    assert.equal(config.enabled, true);
    assert.equal(config.timeoutMs, 1000);
    assert.equal(config.defaultConfidenceThreshold, 0.95);
    assert.equal(config.routing.threshold, 0.9);
    assert.equal(config.toolGate.threshold, 0.98);
    assert.equal(config.hasApiKey, false);
  });

  it("env overrides file config and supplies the key", () => {
    const config = loadJevConfig(
      { endpoint: "https://file.example", model: "file-model" },
      { JEV_ENABLED: "false", JEV_ENDPOINT: "https://env.example", JEV_API_KEY: "secret", JEV_MODEL: "env-model" },
    );
    assert.equal(config.enabled, false);
    assert.equal(config.endpoint, "https://env.example");
    assert.equal(config.model, "env-model");
    assert.equal(config.hasApiKey, true);
    // The snapshot used by diagnostics must never leak the key value.
    const snap = jevDoctorSnapshot(config);
    assert.equal(snap.apiKeyConfigured, true);
    assert.ok(!JSON.stringify(snap).includes("secret"));
  });

  it("reports readiness accurately", () => {
    const ready = loadJevConfig({}, { JEV_ENDPOINT: "https://x.example", JEV_MODEL: "m", JEV_API_KEY: "k" });
    assert.equal(jevReady(ready).ready, true);
    const disabled = loadJevConfig({}, { JEV_ENABLED: "false" });
    assert.equal(jevReady(disabled).ready, false);
    const missing = loadJevConfig({}, {});
    assert.equal(jevReady(missing).ready, false);
  });

  it("rejects invalid thresholds and timeouts", () => {
    assert.throws(() => loadJevConfig({ routing: { threshold: 7 } }, {}), (e: unknown) => e instanceof JevError);
    assert.throws(() => loadJevConfig({}, { JEV_TIMEOUT_MS: "-5" }), (e: unknown) => e instanceof JevError);
    assert.throws(() => loadJevConfig({ defaultConfidenceThreshold: 2 }, {}), (e: unknown) => e instanceof JevError);
  });
});
