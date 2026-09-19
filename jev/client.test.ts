import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { HttpJevClient } from "./client.js";
import { JevError } from "./errors.js";
import { JevDecisionRequest } from "./types.js";

function req(): JevDecisionRequest {
  return {
    requestId: "r1",
    caller: "test",
    questions: [{ key: "route", type: "choice", options: ["a", "b"] }],
  };
}

const baseOptions = {
  endpoint: "https://jev.example",
  apiKey: "k",
  model: "jev-fast",
  timeoutMs: 500,
};

describe("HttpJevClient", () => {
  it("returns structured answers on success", async () => {
    const fetchImpl = (async () =>
      new Response(
        JSON.stringify({
          answers: [
            {
              key: "route",
              decision: { kind: "choice", selected: "a", probabilities: { a: 0.9, b: 0.1 }, confidence: 0.9 },
            },
          ],
          model: "jev-fast",
        }),
        { status: 200 },
      )) as typeof fetch;
    const client = new HttpJevClient({ ...baseOptions, fetchImpl });
    const result = await client.decide(req());
    assert.equal(result.answers[0]?.key, "route");
    assert.equal(result.model, "jev-fast");
  });

  it("throws TIMEOUT when the server is slow", async () => {
    const fetchImpl = (((_url: string, init?: { signal?: AbortSignal }) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const e = new Error("aborted");
          e.name = "AbortError";
          reject(e);
        });
      })) as unknown) as typeof fetch;
    const client = new HttpJevClient({ ...baseOptions, timeoutMs: 20, maxAttempts: 1, fetchImpl });
    await assert.rejects(() => client.decide(req()), (err: unknown) => err instanceof JevError && err.code === "TIMEOUT");
  });

  it("throws NETWORK after retrying transient failures", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return new Response("bad gateway", { status: 502 });
    }) as typeof fetch;
    const client = new HttpJevClient({ ...baseOptions, maxAttempts: 2, fetchImpl });
    await assert.rejects(() => client.decide(req()), (err: unknown) => err instanceof JevError && err.code === "NETWORK");
    assert.equal(calls, 2);
  });

  it("throws AUTH on 401 without retry", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return new Response("no", { status: 401 });
    }) as typeof fetch;
    const client = new HttpJevClient({ ...baseOptions, fetchImpl });
    await assert.rejects(() => client.decide(req()), (err: unknown) => err instanceof JevError && err.code === "AUTH");
    assert.equal(calls, 1);
  });

  it("throws BAD_RESPONSE on malformed payloads", async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({ nope: true }), { status: 200 })) as typeof fetch;
    const client = new HttpJevClient({ ...baseOptions, fetchImpl });
    await assert.rejects(() => client.decide(req()), (err: unknown) => err instanceof JevError && err.code === "BAD_RESPONSE");
  });

  it("rejects empty configuration", () => {
    assert.throws(() => new HttpJevClient({ ...baseOptions, apiKey: "" }), (err: unknown) => err instanceof JevError);
    assert.throws(() => new HttpJevClient({ ...baseOptions, endpoint: "" }), (err: unknown) => err instanceof JevError);
  });
});
