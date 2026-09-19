import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { Server } from "node:http";
import { AddressInfo } from "node:net";
import { HttpJevClient } from "./client.js";
import { FakeJevClient } from "./fake.js";
import { startJevServer } from "./serve.js";
import { TEAM_ROLES } from "./types.js";

describe("jev server", () => {
  let server: Server | undefined;
  after(() => {
    server?.close();
  });

  it("serves /v1/decide end-to-end over HTTP (fake backend)", async () => {
    const probs: Record<string, number> = {};
    for (const r of TEAM_ROLES) probs[r] = r === "reviewer" ? 0.93 : 0.07 / (TEAM_ROLES.length - 1);
    const backend = new FakeJevClient({
      route: { kind: "choice", selected: "reviewer", probabilities: probs, confidence: 0.93 },
    });
    server = await startJevServer({ client: backend, port: 0 });
    const { port } = server.address() as AddressInfo;

    const health = await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal(health.status, 200);

    // Full round trip through the real HTTP client, as sessions would use it.
    const client = new HttpJevClient({
      endpoint: `http://127.0.0.1:${port}`,
      apiKey: "local",
      model: "fake",
      timeoutMs: 2000,
    });
    const result = await client.decide({
      requestId: "e2e-1",
      caller: "e2e",
      questions: [{ key: "route", type: "choice", options: TEAM_ROLES }],
    });
    const decision = result.answers[0]?.decision;
    assert.equal(decision?.kind, "choice");
    if (decision?.kind === "choice") assert.equal(decision.selected, "reviewer");
  });

  it("rejects malformed bodies with 400", async () => {
    const local = await startJevServer({ client: new FakeJevClient({}), port: 0 });
    try {
      const { port } = local.address() as AddressInfo;
      const bad = await fetch(`http://127.0.0.1:${port}/v1/decide`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ nope: true }),
      });
      assert.equal(bad.status, 400);
    } finally {
      local.close();
    }
  });
});
