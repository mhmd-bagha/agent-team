import { createServer, IncomingMessage, Server, ServerResponse } from "node:http";
import { JevClient } from "./client.js";
import { JevError } from "./errors.js";
import { FakeJevClient } from "./fake.js";
import { LlmJevClient, openaiCompatibleCompletion, openaiResponsesCompletion } from "./llm.js";
import { JevDecision, JevDecisionRequest } from "./types.js";

export interface JevServerOptions {
  readonly client: JevClient;
  readonly port: number;
  /** Bind address; always loopback by default. Never 0.0.0.0 without intent. */
  readonly host?: string;
  readonly log?: (event: string, fields: Record<string, string | number>) => void;
}

function readBody(request: IncomingMessage, limitBytes = 256_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > limitBytes) {
        reject(new JevError("BAD_RESPONSE", "Request body too large."));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", () => reject(new JevError("NETWORK", "Failed to read request body.")));
  });
}

function send(response: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  response.writeHead(status, { "content-type": "application/json" });
  response.end(text);
}

function isDecisionRequest(value: unknown): value is JevDecisionRequest {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record["requestId"] === "string" &&
    typeof record["caller"] === "string" &&
    Array.isArray(record["questions"])
  );
}

/** Loopback-only HTTP server speaking the same contract as HttpJevClient. */
export function startJevServer(options: JevServerOptions): Promise<Server> {
  const host = options.host ?? "127.0.0.1";
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    void (async () => {
      try {
        if (request.method === "GET" && request.url === "/health") {
          send(response, 200, { ok: true });
          return;
        }
        if (request.method !== "POST" || request.url !== "/v1/decide") {
          send(response, 404, { error: "not found" });
          return;
        }
        let payload: unknown;
        try {
          payload = JSON.parse(await readBody(request));
        } catch {
          send(response, 400, { error: "invalid JSON body" });
          return;
        }
        if (!isDecisionRequest(payload)) {
          send(response, 400, { error: "body must be a JevDecisionRequest" });
          return;
        }
        // The client's own model field selects the answering model; the
        // request envelope carries no secrets (keys stay in headers/env).
        const result = await options.client.decide(payload as JevDecisionRequest<JevDecision>);
        send(response, 200, result);
      } catch (err) {
        const code = err instanceof JevError ? err.code : "UNKNOWN";
        options.log?.("jev.serve.error", { code });
        send(response, 502, { error: `decision failed: ${code}` });
      }
    })();
  });
  return new Promise((resolve) => {
    server.listen(options.port, host, () => resolve(server));
  });
}

/** Build the production client from environment. Throws when incomplete. */
export function clientFromEnv(env: NodeJS.ProcessEnv = process.env): LlmJevClient {
  const endpoint = env["JEV_PROVIDER_ENDPOINT"] ?? "";
  const apiKey = env["JEV_PROVIDER_API_KEY"] ?? "";
  const model = env["JEV_PROVIDER_MODEL"] ?? env["JEV_MODEL"] ?? "";
  // Wire format: "chat" (default, /chat/completions) or "responses" (/responses,
  // e.g. OpenCode Zen for muse-spark-1.3-contributor-free).
  const api = (env["JEV_PROVIDER_API"] ?? "chat").trim().toLowerCase();
  if (!endpoint || !apiKey || !model) {
    throw new JevError(
      "NOT_CONFIGURED",
      "Set JEV_PROVIDER_ENDPOINT, JEV_PROVIDER_API_KEY, and JEV_PROVIDER_MODEL (or JEV_MODEL).",
    );
  }
  if (api !== "chat" && api !== "responses") {
    throw new JevError("NOT_CONFIGURED", 'JEV_PROVIDER_API must be "chat" or "responses".');
  }
  const complete =
    api === "responses"
      ? openaiResponsesCompletion({ endpoint, apiKey, model })
      : openaiCompatibleCompletion({ endpoint, apiKey, model });
  return new LlmJevClient({ model, complete });
}

/* CLI: `node dist/jev/serve.js` (after `npm run build`). No secrets in output. */
const invokedDirectly =
  typeof require !== "undefined" &&
  typeof module !== "undefined" &&
  require.main === module;
if (invokedDirectly) {
  const port = Number(process.env["JEV_PORT"] ?? 3819);
  let client: JevClient;
  try {
    client = clientFromEnv();
    console.log(`jev: live backend (model from env), listening on 127.0.0.1:${port}`);
  } catch {
    client = new FakeJevClient({});
    console.log(`jev: no provider configured — deterministic fake backend on 127.0.0.1:${port}`);
  }
  void startJevServer({ client, port }).then(() => undefined);
}
