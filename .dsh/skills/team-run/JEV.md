# Jev — Typed Decision Layer

Jev is a **fast, typed decision/intelligence layer** around the Agent Team's
existing agents and orchestration. It answers small judgment questions
("which role?", "how risky?", "another round?") with structured decisions
plus confidence — it never acts.

```text
                         USER REQUEST
                              │
                              ▼
                         TEAM LEAD
                              │
                              ▼
                       ┌─────────────┐
                       │     JEV     │
                       │ DECISION    │
                       │   LAYER     │
                       └──────┬──────┘
                              │
             ┌────────────────┼────────────────┐
             │                │                │
             ▼                ▼                ▼
          ROUTING           RISK            COMPLEXITY
             │                │                │
             ▼                ▼                ▼
          AGENTS          TOOL GATE       EXECUTION TIER
             │
             ▼
        IMPLEMENTATION → TESTING → REVIEW
             │
             ▼
        ┌─────────────┐
        │     JEV     │  verification signals (advisory)
        └──────┬──────┘
               │
       ┌───────┴────────┐
       ▼                ▼
    CONVERGED        CORRECTIVE TASK → AGENT
```

## 1. What Jev is (and is not)

- **Is:** a reusable internal decision service (`jev/`): a small TypeScript
  client plus a decision orchestrator (`JevDecisions`) exposing typed
  primitives — `Choice` (categorical + probabilities), `Score` (0..1 scalar),
  `Noul` (boolean-with-abstention). Provider-neutral: one HTTP contract,
  no coupling to Claude Code or DeepSeek Harness.
- **Is not an agent.** There is no `jev.md` role prompt, no file ownership,
  no delegation packet. Jev never edits files, runs commands, invokes agents,
  or ships anything. It returns decisions; the orchestrator performs actions.

## 2. Where it sits

```text
                    LLM / AGENTS
                  reasoning + coding
                         │
                         ▼
                ┌──────────────────┐
                │   AGENT TEAM     │
                │  orchestration   │
                └────────┬─────────┘
                         │
             ┌───────────┴───────────┐
             │                       │
             ▼                       ▼
        deterministic             Jev
          policy               decisions
             │                       │
             └───────────┬───────────┘
                         ▼
                    final action
```

Code calculates. Jev judges. Agents reason and act. Policy controls.
Evidence verifies.

Integration points (existing protocol untouched):

| Team phase | Jev decision | Gate |
| --- | --- | --- |
| Router (Tier 0/1/2) | `route()` → role + `selectTier()` → tier | routing |
| Delegation | `route()` per task | routing |
| Implementation | `classifyRisk()`, `approveToolAction()` | riskGate / toolGate |
| Context/memory | `compactContext()` → KEEP/TRUNCATE/DROP | always advisory |
| Verification | `evaluateVerification()` (Noul set) | verification |
| Convergence (≤ 8 rounds) | `selectConvergenceAction()` → IGNORE/FIX_NOW/DEFER/BLOCK | verification |
| Model selection | `selectModelTier()` → FAST/BALANCED/STRONG (logical; provider config resolves the model) | advisory |

## 3. Decisions and thresholds

Configured in `config/team-policy.json#/jev` (extended, not a second system):

| Gate | Threshold | Meaning |
| --- | --- | --- |
| routing | 0.90 | below → team-lead / deterministic rule routes |
| riskGate | 0.95 | below → deterministic signal-based risk |
| toolGate | 0.98 | below → deterministic gate |
| verification | 0.95 | below → verify directly from evidence |
| default | 0.95 | model-tier and anything without a specific gate |

## 4. Safety precedence (highest first)

```text
hard policy (no sudo, no destructive git, blocking severities, max rounds)
  > explicit user authorization
  > deterministic safety checks
  > Jev decision
  > LLM suggestion
```

Concretely: Jev may only **tighten** — escalate risk, request review, vote
BLOCK. It can never de-escalate below deterministic risk, authorize sudo /
destructive git / unreviewed credential or migration actions, lift a BLOCK on
critical (or high-severity security) findings, or drop protected context
(acceptance criteria, requirements, constraints, security findings, blockers,
verification evidence, file ownership, final test results) without explicit
policy. Hard-policy tool verdicts short-circuit before any Jev call.

## 5. Fallbacks

```text
Jev → deterministic rule → existing LLM/orchestrator → human clarification
```

On timeout, unavailability, invalid data, over-latency, or low confidence,
each method returns its deterministic fallback plus `fallbackUsed` /
`fallbackReason`. The team functions fully with:

```text
JEV_ENABLED=false
```

## 6. Environment configuration

Secrets come from the environment only — never from JSON, never into logs:

```text
JEV_API_KEY     # required for live calls; never printed (see doctor)
JEV_ENDPOINT    # e.g. https://jev.internal
JEV_MODEL       # logical model name
JEV_ENABLED     # false disables Jev entirely (default true)
JEV_TIMEOUT_MS  # per-attempt timeout, default 1000
```

File values in `config/team-policy.json#/jev` provide defaults; env wins for
endpoint/model/timeout/enabled.

## 6b. Live mode (LLM-backed judgments)

Out of the box Jev answers from deterministic policy (safe, offline). For
real model judgments, run the loopback adapter server:

```bash
npm run jev:serve   # reads ~/.config/agent-team/jev.env (mode 600, never committed)
```

`scripts/jev-serve.sh` sources (creating the template if absent is up to you):

```text
JEV_PORT=3819
JEV_ENDPOINT=http://127.0.0.1:3819
JEV_MODEL=jev-local
JEV_API_KEY=local                      # server ignores it on loopback
JEV_PROVIDER_ENDPOINT=https://api.deepseek.com   # OpenAI-compatible
JEV_PROVIDER_API_KEY=<secret>
JEV_PROVIDER_MODEL=deepseek-chat
```

How it fits: `LlmJevClient` (`jev/llm.ts`) turns one `CompleteFn` into typed
`Choice`/`Score`/`Noul` answers — one LLM call per batched request, strict
JSON, validated with the same parsers as the client. `openaiCompatibleCompletion`
covers OpenAI/DeepSeek/OpenRouter-style gateways (temperature 0,
`json_object`); other providers plug in as a ~10-line `CompleteFn`.
`jev/serve.ts` exposes the same `/v1/decide` contract as `HttpJevClient`,
so sessions point `JEV_ENDPOINT` at the loopback server and change nothing
else. Without provider vars the server runs the deterministic fake backend
(typed decisions, offline-safe) instead of failing.

Provider notes:

- OpenCode Zen free-tier models (e.g. `muse-spark-1.3-contributor-free`)
  return `FreeTierError` outside OpenCode — the free tier only works from
  within OpenCode sessions. External live mode needs Zen credits (paid
  models) or a third-party key (DeepSeek/OpenRouter/compatible gateway).
- Inside an OpenCode session, the team-lead can act as the decision layer
  directly: the `team-run` skill rules (thresholds, precedence, fallbacks)
  apply to its own judgments — no server needed.
- Contributor-tier free models may use prompts for training (see Zen
  privacy notes); never send secrets or private data as Jev context.

## 7. Performance

- One shared state + many typed questions → **one** Jev call (`decideBatch`).
- Independent decisions are parallelized; Jev never sits in a hot loop.
- Per-attempt timeout (default 1000ms) with one retry on 429/5xx/timeout;
  auth/validation errors are not retried.
- Hard-policy tool verdicts skip the Jev call entirely.

## 8. Observability

Every decision emits a JSON log line (`jev.decision`) with: decision type,
decision, confidence, probabilities summary, latency, model, caller, phase,
task id, fallback used/reason. Never: API keys, auth headers, full prompts,
or private data. `JevTelemetry.summary()` answers: route rate, fallback rate,
below-threshold count, policy-override count, p50/p95 latency.

## 9. Testing

```bash
npm run typecheck   # tsc --noEmit
npm run build       # tsc → dist/
npm test            # build + node --test dist/jev/*.test.js
```

`FakeJevClient` (scripted deterministic decisions) and `FailingJevClient`
(simulated outage) cover success, timeout, network failure, malformed
responses, auth failure, invalid decisions, low confidence, policy overrides,
and the disabled path — no real API key required. At least one integration
test exercises the orchestration boundary (`evaluateVerification` batch =
one call, three answers) through the fake.

## 10. Diagnostics

```bash
./scripts/jev-doctor.sh
# or: npm run doctor:jev
```

Reports enabled/endpoint/key/model/timeout/connectivity/latency/config
validity. The key is reported as `yes/no` only — never printed.

## 11. Provider independence

Jev resolves **logical** tiers (`FAST`/`BALANCED`/`STRONG`); existing
provider configuration maps them to concrete models. The same prompts,
policy, and workflow run on Claude Code, DeepSeek Harness, and portable
runners — see `providers/portable-agent.md`.
