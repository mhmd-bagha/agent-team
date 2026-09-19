# Universal Agent Team

> One team protocol for every agent runner: requirements in, verified delivery out — with evidence, not vibes.

A provider-neutral senior-engineering orchestration layer for Claude Code, DeepSeek Harness, and other compatible agents. It turns any capable agent runner into a disciplined engineering team: a lead that owns the request end-to-end, specialists that research, design, implement, test, and attack the change, and an independent verifier that trusts no claim it has not checked itself.

## Table of Contents

- [What This Is](#what-this-is)
- [Features](#features)
- [How It Works: The Lifecycle](#how-it-works-the-lifecycle)
- [The Team: 9 Roles](#the-team-9-roles)
- [The Skills](#the-skills)
- [The Rules](#the-rules)
- [Stop Conditions & Hard Blockers](#stop-conditions--hard-blockers)
- [Installation](#installation)
- [Usage](#usage)
- [Memory & Speed](#memory--speed)
- [Parallelism, Worktrees & Delegation](#parallelism-worktrees--delegation)
- [Verification & Confidence Model](#verification--confidence-model)
- [Progress Reports](#progress-reports)
- [Configuration Reference](#configuration-reference)
- [Utilities](#utilities)
- [Repository Layout](#repository-layout)
- [What Lives Here vs On Your Machine](#what-lives-here-vs-on-your-machine)
- [Safety Defaults](#safety-defaults)
- [FAQ](#faq)

## What This Is

A single agent asked to "build the feature" tends to do three things: skim the repo, write a big diff, and declare victory. This repository replaces that with a team contract (`TEAM.md`): one lead owns the request from intake to verified delivery, work is decomposed into independently verifiable tasks, specialists handle research, design, implementation, testing, and adversarial review in parallel where safe, and nothing ships until an independent verifier confirms every requirement against real evidence — commands run, tests passed, diffs inspected.

The contract is provider-neutral. The same role prompts and workflow run on Claude Code (native agents and skills), on DeepSeek Harness (subagents plus filesystem-discovered skills), on OpenCode (`@`-mentioned subagents plus skills), and on any other runner that can receive a task prompt, inspect a repo, edit a scope, run commands, and return a structured report (see `providers/portable-agent.md`).

This repository contains orchestration policy and prompts. It does not claim an LLM can mathematically prove a change is bug-free. The final gate requires concrete evidence: requirements coverage, checks, tests, review findings, and unresolved-risk accounting. The verdict is `CONVERGED` or it is not done — never "100% bug-free".

## Features

- **Requirements-first execution.** Intake captures outcome, constraints, acceptance criteria, and risk before any code is touched; the lead finishes only when every requirement maps to an implementation and verification evidence.
- **Spec Kit integration with fallback.** Non-trivial feature work is specified first: the full Spec Kit flow (constitution → specify → clarify → plan → checklist → tasks → analyze) when Spec Kit is installed in the target project, otherwise a lightweight spec (outcome, constraints, acceptance criteria, task graph).
- **Nine specialist roles.** Team-lead, architect, researcher, implementer, reviewer, test-engineer, security-reviewer, performance-reviewer, and final-verifier. Every delegation carries a fixed packet: objective, repository context, exact scope, allowed files/directories, expected output, verification command(s), and dependencies.
- **Safe parallelism only.** Tasks run in parallel only when their read/write sets do not conflict and their outputs form no dependency chain — capped at 6 parallel agents (`config/team-policy.json`).
- **Isolated worktrees for overlapping edits.** One worktree per implementation agent when two agents can touch the same directory; a shared checkout is fine for read-only agents and strictly disjoint file ownership.
- **Structured progress reports.** Every phase ends in `STATUS / DONE / EVIDENCE / FINDINGS / NEXT` — short enough to follow, concrete enough to audit, emitted by `scripts/report.sh`.
- **Mandatory verification gates.** Format, lint, typecheck/build, focused tests first then the broader suite, E2E when applicable — plus a stop-gate example (`hooks/verify-before-stop.sh`) so reports cannot claim checks the project does not have.
- **Evidence-backed confidence (target ≥ 0.95).** A weighted score across requirements coverage, implementation correctness, automated verification, independent review, security, and performance — where any single critical finding overrides the score and blocks release.
- **Automatic convergence loop (up to 8 rounds).** Any review or verification finding becomes a corrective task: fix, rerun affected checks, review again — until all gates pass or a hard blocker is documented.
- **Adversarial review by default.** An independent reviewer assumes the implementation is wrong; security and performance reviewers attack auth, input handling, injection, secrets, unsafe I/O, N+1s, leaks, and blocking work. Critical/high findings block release.
- **Provider adapters.** Claude Code, DeepSeek Harness (skill discovery verified against the installed release), and a portable contract for ACP/Codex/Kimi/KUN-style runners — one engineering policy, no per-provider duplication.
- **Auto-memory + tier router.** Project memory (`memory/MEMORY.md`) is read at intake and updated at the final gate, so conventions and past fixes compound across sessions; requests route to the lowest fitting tier — instant answer, scoped single-agent fix, or full team — so one-line fixes stay fast.
- **One-command installers plus always-on wiring.** `./scripts/bootstrap-claude.sh`, `./scripts/bootstrap-dsh.sh`, and `./scripts/bootstrap-opencode.sh` install per-project or user-global (including a starter `memory/MEMORY.md` that is never overwritten); optional always-on wiring in `~/.claude/CLAUDE.md` / `~/.dsh/AGENTS.md` makes the team fire on every implementation message with no slash command.

## How It Works: The Lifecycle

```text
RECEIVE -> UNDERSTAND -> SCAN -> CLARIFY -> SPECIFY -> PLAN -> TASKS
-> ANALYZE -> PARALLEL IMPLEMENT -> INTEGRATE -> TEST -> REVIEW
-> ADVERSARIAL REVIEW -> CONVERGE -> FINAL VERIFY -> REPORT
```

The `team-run` skill implements this chain as ten phases:

| Phase | Name | What happens |
| --- | --- | --- |
| 0 | Intake | Restate the outcome; capture constraints, acceptance criteria, risk |
| 1 | Repository scan | Inspect structure, scripts, CI, tests, docs, relevant modules, existing implementations |
| 2 | Specification | Spec Kit flow when installed, otherwise a lightweight spec (outcome, constraints, acceptance, task graph) |
| 3 | Delegation | Dependency-aware task graph; spawn independent tasks in parallel with explicit file ownership |
| 4 | Implementation | Scoped edits only; worktrees for overlapping scopes; minimal, convention-preserving changes |
| 5 | Integration | Collect reports, inspect diffs, resolve conflicts semantically, run integration checks |
| 6 | Verification | Format, lint, typecheck/build, focused then broader tests, E2E when applicable |
| 7 | Adversarial review | Independent reviewer + security reviewer + performance reviewer try to break it |
| 8 | Convergence | Every finding becomes a corrective task; fix, rerun, re-review; repeat (max 8 rounds) |
| 9 | Final gate | Independent final-verifier establishes evidence for every requirement; verdict `CONVERGED`, `BLOCKED`, or `NOT CONVERGED` |

Small fixes follow the same principles without forcing unnecessary artifacts.

## The Team: 9 Roles

Role prompts live in `.claude/agents/` (and ship as resources under the DSH `team-run` skill in `agents/`):

| Role | File | Job |
| --- | --- | --- |
| team-lead | `.claude/agents/team-lead.md` | Owns the request end-to-end: intake, task graph, delegation, integration, convergence, final evidence-backed report |
| architect | `.claude/agents/architect.md` | Inspects existing architecture; proposes the minimal maintainable design with rejected alternatives, affected files, and test strategy (no production edits unless asked) |
| researcher | `.claude/agents/researcher.md` | Focused technical research from official/primary sources; returns findings, version context, recommended approach, compatibility risks, and exact sources |
| implementer | `.claude/agents/implementer.md` | Writes scoped, minimal, strictly-typed production code plus behavior tests; formats, typechecks/builds, runs focused tests, inspects the diff |
| reviewer | `.claude/agents/reviewer.md` | Independent code review assuming the implementation may be wrong: correctness, edge cases, API compatibility, error handling, test quality, unintended changes |
| test-engineer | `.claude/agents/test-engineer.md` | Builds a test matrix from requirements (happy path, boundaries, invalid input, auth, concurrency, regressions, E2E); never weakens tests to match broken behavior |
| security-reviewer | `.claude/agents/security-reviewer.md` | Adversarial security review: auth/authz, validation, injection, secrets, unsafe file/process ops, SSRF/traversal, XSS/CSRF, dependencies, exposure; classifies critical/high/medium/low |
| performance-reviewer | `.claude/agents/performance-reviewer.md` | Reviews N+1s, extra network calls, renders, loops/queues, leaks, blocking ops, caching, concurrency hazards; recommends complexity only with evidence |
| final-verifier | `.claude/agents/final-verifier.md` | Independently verifies the finished state against every requirement; outputs the requirement matrix, exact commands and results, residual risks, and the final verdict |

Every delegation to a specialist must contain all seven of: objective, repository context, exact scope, allowed files/directories, expected output, verification command(s), dependencies. Parallel work is allowed only for tasks with no unsafe file/dependency overlap.

## The Skills

### team-run

Ships at `.claude/skills/team-run/SKILL.md` (Claude Code) and `.dsh/skills/team-run/` (DeepSeek Harness, with role prompts as resources). Trigger: any message that implements, fixes, refactors, debugs, migrates, or otherwise completes engineering work. Protocol: the ten phases above. Checkpoints with `STATUS / DONE / EVIDENCE / FINDINGS / NEXT` reports at intake, plan, implementation batches, integration, test, review, convergence, and final result.

### final-verification

Ships at `.claude/skills/final-verification/SKILL.md` and `.dsh/skills/final-verification/`. It never trusts prior summaries: it builds a requirement-to-evidence matrix (`Requirement | Implementation | Verification | Status`), inspects the final diff, runs the repo's relevant checks, and returns one verdict — `CONVERGED` (all gates pass, no material residual risk), `BLOCKED` (a mandatory gate cannot pass for external/authorization reasons), or `NOT CONVERGED` (work remains). Never "100% bug-free".

### How DeepSeek Harness discovers the skills

Verified against the installed Harness: `@deepseek-ai/dsh-skill-filesystem` scans these roots for directory bundles (`<name>/SKILL.md`) or flat `<name>.md` files:

1. `<project>/.dsh/skills` (project rank)
2. `<project>/.agents/skills` (project rank)
3. custom skill dirs (when configured)
4. `${DSH_HOME:-~/.dsh}/skills` (user-global rank)
5. `${DSH_AGENTS_HOME:-~/.agents}/skills` (user-global rank)
6. bundled skill dir (when configured)

Each `SKILL.md` needs YAML frontmatter with at least `name` (lowercase kebab-case) and `description`; bodies load on demand with the skill directory as resource base. Workspace instructions load from `AGENTS.md` / `CLAUDE.md` (project and nested scopes) plus `$DSH_HOME/AGENTS.md` (user-global). Full mapping in `providers/deepseek-harness.md`.

## The Rules

`TEAM.md` sets 16 operating rules, condensed here — read the contract itself before substantial work:

1. Read the repository before designing changes.
2. Search for existing implementations before creating new abstractions.
3. Preserve architecture and conventions unless the task requires changing them.
4. Ask only material clarification questions; record safe interpretations as assumptions and continue.
5. Specify before implementing on non-trivial work (Spec Kit when installed, lightweight spec otherwise).
6. Decompose into independently verifiable tasks.
7. Parallelize only tasks with no unsafe file/dependency overlap.
8. Give each implementation task explicit file ownership.
9. Use isolated worktrees when agents may touch overlapping files.
10. Integrate before final verification.
11. Test behavior, not only compilation.
12. Review the diff for unintended changes.
13. Run an adversarial review that tries to break the implementation.
14. Fix findings and rerun affected checks.
15. Converge until gates pass or a hard blocker is documented.
16. Never fabricate certainty — report evidence and remaining risk.

Engineering standard (`.claude/CLAUDE.md`): act as a senior engineer; prefer minimal high-quality changes; no `any` unless the repo requires it; reuse existing utilities, hooks, services, components, and patterns; keep public APIs stable; no unrelated formatting changes; never silently weaken validation or error handling; never delete tests to make the suite pass; focused tests first, then the broader suite; always inspect the final diff.

Reporting rule: after each major phase emit Status / What changed / Evidence-checks / Problems / Next action — and never report a check as passed unless it was executed.

Policy knobs (`config/team-policy.json`): max 6 parallel agents, max 8 convergence rounds, 0.95 confidence target, critical/high findings block release, requirement traceability and test evidence required, final independent verifier required, no destructive git, no sudo, isolate-on-overlap via worktrees, phase-and-batch progress reporting.

## Stop Conditions & Hard Blockers

The Team Lead may finish only when every accepted requirement has an implementation mapping and verification evidence; the repo's build/typecheck/lint checks pass; relevant automated tests (plus integration/E2E when applicable) pass; security has no unresolved critical/high finding; performance has no unresolved material regression; the diff contains no unrelated changes; spec/plan/tasks are converged; and remaining risks are explicitly reported.

Stop and report a blocker — never claim completion through it — when required credentials or access are missing, the request conflicts with a repository invariant, a required external system is unavailable and cannot be mocked safely, a destructive action needs user authorization, or tests cannot run for lack of infrastructure.

## Installation

### Claude Code

Enable native Agent Teams:

```bash
export CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1
claude
```

Install Spec Kit in the target project (for the full specify-first flow):

```bash
uv tool install specify-cli
specify init . --integration claude
```

Per-project install (agents + skills + `TEAM.md`):

```bash
./scripts/bootstrap-claude.sh /path/to/project
```

User-level install (available in every session — 9 agents plus the `team-run` and `final-verification` skills):

```bash
mkdir -p ~/.claude/agents ~/.claude/skills/team-run ~/.claude/skills/final-verification
cp .claude/agents/*.md ~/.claude/agents/
cp .claude/skills/team-run/SKILL.md ~/.claude/skills/team-run/SKILL.md
cp .claude/skills/final-verification/SKILL.md ~/.claude/skills/final-verification/SKILL.md
```

### DeepSeek Harness

Per-project install (DSH auto-discovers `<project>/.dsh/skills`):

```bash
./scripts/bootstrap-dsh.sh /path/to/project
```

User-global install (available in every session — DSH auto-discovers `${DSH_HOME:-~/.dsh}/skills`):

```bash
./scripts/bootstrap-dsh.sh --global
```

Then delegate per `providers/deepseek-harness.md`: team-lead as the root agent, specialists as subagents (background for independent research/verification), implementers scoped or as Claude Code children, and the final-verifier as an independent child session. Role prompts ship as resources under `team-run/` (`TEAM.md`, `team-policy.json`, `agents/*.md`).

### OpenCode

Per-project install (OpenCode auto-discovers `<project>/.opencode/skills` and `<project>/.opencode/agents`):

```bash
./scripts/bootstrap-opencode.sh /path/to/project
```

User-global install (available in every session — OpenCode auto-discovers `~/.config/opencode/skills` and `~/.config/opencode/agents`; running sessions pick it up on reload):

```bash
./scripts/bootstrap-opencode.sh --global
```

Invoke specialists with `@`-mentions (e.g. `@team-lead`, `@implementer`) or let the primary agent delegate via the Task tool; run the finish through the `final-verification` skill. (OpenCode also reads `~/.claude/skills` and `~/.agents/skills`, so the Claude user-global install below covers skills too — the native install above additionally ships role agents plus `TEAM.md`/policy/`JEV.md` resources alongside the skills.)

### KUN / Kimi / other agents

Use `providers/portable-agent.md`: any runner qualifies if it can (1) receive a complete task prompt, (2) inspect the repository, (3) edit its assigned scope, (4) run commands, and (5) return a structured report. Map the roles onto whatever delegation the runner offers — ACP spawning, native app/server integration, skills, slash commands, or subprocesses. Do not duplicate the engineering policy per provider.

## Usage

### Automatic mode (recommended)

Add a `team-run` always-on section to your user memory so the team fires on every implementation message with no slash command: the `~/.claude/CLAUDE.md` section for Claude Code, the `~/.dsh/AGENTS.md` block for DeepSeek Harness. The trigger is the work itself — implement, build, add, fix, refactor, debug, migrate — every session, every message. Even a one-line fix goes through `team-run` (at minimum a scoped implementer with verification evidence); anything beyond a single-file fix additionally gets reviewer and final-verifier before reporting.

OFF switches: say "stop team", "no team", or "single mode" to work inline until re-enabled; the global "no skills" / "plain mode" switch covers this skill too.

### Manual invocation

Invoke `/team-run` (or the `team-run` skill) in any session for the full protocol, and route the finish through the `final-verification` gate before reporting done.

### Typical sessions

Bugfix — "the login redirect drops the return URL after SSO":

```text
STATUS: intake
DONE: reproduced on staging config; requirement: preserve ?next= through the SSO round-trip
EVIDENCE: npm test auth/redirect (1 failing: preserves-next-url), src/auth/callback.ts:41-58 read
FINDINGS: implementer fixed param forwarding in callback.ts; reviewer found unencoded edge case, fixed; tests 14/14 pass; security review clean
NEXT: CONVERGED — merged, no residual risk
```

Feature — "add CSV export to the orders table":

```text
STATUS: plan
DONE: lightweight spec written (columns, escaping, 50k-row streaming requirement); tasks split: exporter + UI button + tests
EVIDENCE: spec in plan.md; delegation packets with file ownership (export/csv.ts, OrdersTable.tsx, export.test.ts)
FINDINGS: performance review flagged full-buffer string building; switched to streaming writer; 500-row and 50k-row tests pass
NEXT: final-verifier running the requirement matrix
```

Regression hunt — "the ORM upgrade broke 6 tests":

```text
STATUS: convergence round 2
DONE: researcher traced 6 failures to 2 breaking query-builder changes (see changelog 4.2, exact links); implementer adapted call sites
EVIDENCE: npm test (was 6 failing, now 1); remaining failure is a pre-existing flaky timezone test, unrelated diff confirmed
FINDINGS: reviewer approved; awaiting final-verifier verdict
NEXT: CONVERGED or BLOCKED on the flaky-test infrastructure
```

## Memory & Speed

Project memory lives at `memory/MEMORY.md` (shipped as a starter template by both installers; existing memory is never overwritten). The loop: team-lead reads it at intake, every delegation inherits the relevant excerpts (facts, conventions, preferences, past issue→resolution rows), and the final-verifier appends session learnings (decisions, new conventions, resolutions, preference notes) — so the team gets smarter every session instead of re-learning your repo.

Requests route to the lowest tier that fits:

| Tier | When | What runs |
| --- | --- | --- |
| **Tier 0 — instant** | Greetings, factual Q&A, explanations, how-things-work | Direct answer; no delegation, no reports |
| **Tier 1 — scoped team** | Single-file fix or small addition (e.g. "fix the off-by-one in `sum.js`") | Implementer only + verification evidence |
| **Tier 2 — full team** | Features, refactors, migrations, multi-file work | Full 10-phase protocol with convergence |

Route to the lowest tier that fits; escalate when uncertainty or blast radius grows.

## Parallelism, Worktrees & Delegation

Parallelize only tasks whose read/write sets do not conflict and whose outputs do not form a dependency chain (`docs/WORKFLOW.md`):

```text
requirements
    |
    +--> architecture
    +--> research
    |
    +--> backend implementation ----+
    +--> frontend implementation ---+--> integration
    +--> test design ----------------+
                                      |
                                      v
                              verification
                                      |
                                      v
                              adversarial review
                                      |
                              +-------+-------+
                              |               |
                            findings         clean
                              |               |
                              v               v
                            fix            final gate
                              |
                              +--> verification
```

Use one worktree per implementation agent when two agents can touch the same directory, when a task is large enough to benefit from independent review, or when a branch/commit boundary is useful. A shared checkout is acceptable for read-only agents and strictly disjoint file ownership. Every delegation carries objective, repository context, exact scope, allowed files/directories, expected output, verification command(s), and dependencies; collect all subagent results before integration.

## Verification & Confidence Model

Layered verification runs in this order: formatting, lint, typecheck/build, focused tests, broader regression tests, E2E when applicable — then independent review, then the final gate. The confidence target is ≥ 0.95 evidence-backed (never a fabricated probability), scored as:

| Component | Weight |
| --- | --- |
| Requirements coverage | 25% |
| Implementation correctness | 20% |
| Automated verification | 25% |
| Independent review | 10% |
| Security | 10% |
| Performance / regression | 10% |

A single critical security/correctness finding overrides the score and blocks convergence. Link every claim to evidence: file paths, commits/diffs, command output, test names, requirement IDs.

## Progress Reports

Agents emit concise reports at intake, plan, implementation batches, integration, test, review, convergence, and the final result — via `scripts/report.sh`:

```bash
./scripts/report.sh <phase> <status> <done> <evidence> [findings] [next]
```

```text
STATUS: <phase>
DONE: <facts>
EVIDENCE: <commands/files/results>
FINDINGS: <issues or none>
NEXT: <next action>
```

## Configuration Reference

| File | Purpose |
| --- | --- |
| `TEAM.md` | The team contract: mission, 16 operating rules, stop conditions, hard blockers |
| `config/team-policy.json` | Policy knobs: 6 parallel agents, 8 convergence rounds, 0.95 target, blocking severities, required gates — plus the `jev` decision-layer section (gates, thresholds, timeout; secrets via `JEV_*` env) |
| `jev/` | Jev typed decision layer (provider-neutral TS): client, decisions, policy fallbacks, telemetry, fake test adapter. Disabled entirely with `JEV_ENABLED=false` |
| `.claude/CLAUDE.md` | Engineering standard, specify-first workflow, reporting rule for Claude-installed projects |
| `.claude/agents/*.md` | The 9 role prompts (source of truth) |
| `.claude/skills/team-run/SKILL.md` | The 10-phase team workflow skill (source of truth) |
| `.claude/skills/final-verification/SKILL.md` | The independent final-gate skill (source of truth) |
| `.dsh/skills/` | Generated DSH copy (skills + agents + `TEAM.md` + policy); regenerate, do not hand-edit |
| `providers/deepseek-harness.md` | DSH role mapping, verified skill-discovery roots, install commands |
| `providers/portable-agent.md` | 5-capability contract + mapping for ACP/Codex/Kimi/KUN-style runners |
| `docs/WORKFLOW.md` | Parallelism diagram, worktree policy, confidence scoring, reporting guidance |
| `docs/JEV.md` | Jev decision layer: architecture, decision catalog, thresholds, safety precedence, fallbacks, env config, observability, testing |
| `scripts/bootstrap-claude.sh` | Per-project Claude installer |
| `scripts/bootstrap-dsh.sh` | Per-project + `--global` DSH installer |
| `scripts/bootstrap-opencode.sh` | Per-project + `--global` OpenCode installer (skills + agents) |
| `scripts/report.sh` | One-shot structured progress report emitter |
| `hooks/verify-before-stop.sh` | Stop-gate example listing the project's available verification scripts |

## Utilities

- `scripts/bootstrap-claude.sh [target]` — installs `TEAM.md`, `CLAUDE.md`, agents, and both skills into a project's `.claude/` (defaults to `.`).
- `scripts/bootstrap-dsh.sh <project> | --global [--help]` — installs both skills plus role resources into `<project>/.dsh/skills` or `${DSH_HOME:-~/.dsh}/skills`; rejects unknown flags, guards the agent glob, idempotent.
- `scripts/report.sh <phase> <status> <done> <evidence> [findings] [next]` — emits one team progress report in `STATUS/DONE/EVIDENCE/FINDINGS/NEXT` format.
- `scripts/jev-doctor.sh` — Jev diagnostics (enabled, endpoint/key/model configured, connectivity, latency, config validity; never prints the key).
- `hooks/verify-before-stop.sh` — optional stop-gate example: lists which of `lint`, `typecheck`, `test`, `build` the current project actually offers, so a final report cannot claim checks that do not exist.

## Repository Layout

```text
.
├── TEAM.md                      # the contract
├── README.md                    # this file
├── .gitignore
├── memory/
│   └── MEMORY.md                # project memory template (read at intake, updated at gate)
├── config/
│   └── team-policy.json         # parallelism, rounds, confidence, blocking rules
├── docs/
│   ├── WORKFLOW.md              # parallelism, worktrees, confidence, reporting
│   └── JEV.md                   # Jev decision layer (advisory; disable with JEV_ENABLED=false)
├── jev/                         # typed decision layer (TS): client, decisions,
│                                # policy fallbacks, telemetry, fake test adapter
│                                # (typecheck: npm run typecheck; tests: npm test)
├── providers/
│   ├── deepseek-harness.md      # DSH role mapping + verified discovery roots
│   └── portable-agent.md        # 5-capability contract for other runners
├── scripts/
│   ├── bootstrap-claude.sh      # per-project Claude installer
│   ├── bootstrap-dsh.sh         # per-project + global DSH installer
│   ├── bootstrap-opencode.sh    # per-project + global OpenCode installer (skills + agents)
│   └── report.sh                # progress-report emitter
├── hooks/
│   └── verify-before-stop.sh    # stop-gate example
├── .claude/                     # SOURCE OF TRUTH for prompts + skills
│   ├── CLAUDE.md
│   ├── agents/                  # 9 role prompts
│   └── skills/
│       ├── team-run/SKILL.md
│       └── final-verification/SKILL.md
└── .dsh/                        # GENERATED copy (re-run bootstrap-dsh.sh .)
    └── skills/
        ├── team-run/            # SKILL.md + agents/ + TEAM.md + team-policy.json
        └── final-verification/  # SKILL.md
```

## What Lives Here vs On Your Machine

Committed here (safe to publish): everything — role prompts, skills, `TEAM.md`, policy, installers, docs. The `.dsh/skills/` tree is a generated copy of `.claude/skills/` plus `TEAM.md`/`team-policy.json`; `.claude/` is the source of truth — do not edit the copies by hand, re-run `./scripts/bootstrap-dsh.sh .` instead.

Machine-local (never commit, stays on your machine): the always-on wiring that makes the team fire automatically — your `~/.claude/CLAUDE.md` team-run section and `~/.dsh/AGENTS.md`. Those reference your local paths and personal skill setup; the installers above deliberately do not touch them. Back them up separately if you care.

## Safety Defaults

- No sudo.
- No destructive git operations.
- No force push.
- No secret exfiltration.
- No edits outside the requested scope.
- Never skip failing tests merely to reach a green result.
- Never claim a test passed unless it actually ran.

## FAQ

**Do I need Spec Kit?** No. Use it when it is installed — the specify-first rule then runs its full flow. Otherwise the team writes a lightweight spec (outcome, constraints, acceptance criteria, task graph) and proceeds through the same gates.

**Does this work without Claude Code or DeepSeek Harness?** Yes, if your runner meets the five capabilities in `providers/portable-agent.md`: receive a task prompt, inspect the repo, edit a scope, run commands, return a structured report. Map the roles onto ACP, Codex, skills, slash commands, or subprocesses.

**Won't the full team be slow for one-line fixes?** No — small fixes use the same principles without the heavy artifacts: at minimum a scoped implementer (read, minimal edit, run the repo's checks, report with evidence). The overhead scales with the change; verification evidence is never skipped.

**How do I turn it off?** Say "stop team", "no team", or "single mode" for inline work until re-enabled; the global "no skills" / "plain mode" switch covers it too. Remove the always-on section from `~/.claude/CLAUDE.md` / `~/.dsh/AGENTS.md` to unwire it permanently.

**Does CONVERGED mean bug-free?** No — and the team never claims that. It means every requirement has an implementation mapping and verification evidence, the gates pass, reviews have no unresolved blocking findings, and remaining risks are explicitly reported. Evidence, not certainty.
