import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { JevError } from "./errors.js";
import { LlmJevClient, openaiCompatibleCompletion, openaiResponsesCompletion } from "./llm.js";
import { TEAM_ROLES } from "./types.js";

function roleProbs(selected: string, confidence: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of TEAM_ROLES) out[r] = r === selected ? confidence : (1 - confidence) / (TEAM_ROLES.length - 1);
  return out;
}

describe("LlmJevClient", () => {
  it("parses batched choice+noul answers from one LLM call", async () => {
    let calls = 0;
    const client = new LlmJevClient({
      model: "test-model",
      complete: async () => {
        calls += 1;
        return JSON.stringify({
          route: {
            kind: "choice",
            selected: "implementer",
            probabilities: roleProbs("implementer", 0.95),
            confidence: 0.95,
          },
          satisfied: { kind: "noul", value: true, confidence: 0.96 },
        });
      },
    });
    const result = await client.decide({
      requestId: "r1",
      caller: "test",
      questions: [
        { key: "route", type: "choice", options: TEAM_ROLES },
        { key: "satisfied", type: "noul" },
      ],
    });
    assert.equal(calls, 1);
    assert.equal(result.answers.length, 2);
    const route = result.answers[0]?.decision;
    assert.equal(route?.kind, "choice");
    if (route?.kind === "choice") assert.equal(route.selected, "implementer");
  });

  it("throws INVALID_DECISION on out-of-option selections", async () => {
    const client = new LlmJevClient({
      model: "m",
      complete: async () =>
        JSON.stringify({
          route: { kind: "choice", selected: "janitor", probabilities: {}, confidence: 0.9 },
        }),
    });
    await assert.rejects(
      () =>
        client.decide({
          requestId: "r1",
          caller: "test",
          questions: [{ key: "route", type: "choice", options: TEAM_ROLES }],
        }),
      (err: unknown) => err instanceof JevError && err.code === "INVALID_DECISION",
    );
  });

  it("throws BAD_RESPONSE on non-JSON output", async () => {
    const client = new LlmJevClient({ model: "m", complete: async () => "Let me think about this…" });
    await assert.rejects(
      () =>
        client.decide({
          requestId: "r1",
          caller: "test",
          questions: [{ key: "s", type: "score" }],
        }),
      (err: unknown) => err instanceof JevError && err.code === "BAD_RESPONSE",
    );
  });

  it("throws TIMEOUT on slow providers", async () => {
    const client = new LlmJevClient({
      model: "m",
      timeoutMs: 20,
      complete: async () => {
        await new Promise((r) => setTimeout(r, 500));
        return "{}";
      },
    });
    await assert.rejects(
      () =>
        client.decide({
          requestId: "r1",
          caller: "test",
          questions: [{ key: "s", type: "score" }],
        }),
      (err: unknown) => err instanceof JevError && err.code === "TIMEOUT",
    );
  });
});

describe("openaiCompatibleCompletion", () => {
  it("posts chat/completions and returns content", async () => {
    let seenUrl = "";
    const fetchImpl = (async (url: string | URL | Request) => {
      seenUrl = String(url);
      return new Response(
        JSON.stringify({ choices: [{ message: { content: '{"a":1}' } }] }),
        { status: 200 },
      );
    }) as typeof fetch;
    const complete = openaiCompatibleCompletion({
      endpoint: "https://api.example.com",
      apiKey: "k",
      model: "m",
      fetchImpl,
    });
    assert.equal(await complete("sys", "user"), '{"a":1}');
    assert.ok(seenUrl.endsWith("/chat/completions"));
  });

  it("maps 401 to AUTH without retry", async () => {
    const fetchImpl = (async () => new Response("no", { status: 401 })) as typeof fetch;
    const complete = openaiCompatibleCompletion({ endpoint: "https://x.example", apiKey: "k", model: "m", fetchImpl });
    await assert.rejects(() => complete("s", "u"), (err: unknown) => err instanceof JevError && err.code === "AUTH");
  });
});

describe("openaiResponsesCompletion", () => {
  it("posts /responses and concatenates output text", async () => {
    let seenUrl = "";
    const fetchImpl = (async (url: string | URL | Request) => {
      seenUrl = String(url);
      return new Response(
        JSON.stringify({
          output: [{ type: "message", content: [{ type: "output_text", text: '{"a":' }, { type: "output_text", text: '1}' }] }],
        }),
        { status: 200 },
      );
    }) as typeof fetch;
    const complete = openaiResponsesCompletion({
      endpoint: "https://opencode.ai/zen/v1",
      apiKey: "k",
      model: "muse-spark-1.3-contributor-free",
      fetchImpl,
    });
    assert.equal(await complete("sys", "user"), '{"a":1}');
    assert.ok(seenUrl.endsWith("/responses"));
  });
});
