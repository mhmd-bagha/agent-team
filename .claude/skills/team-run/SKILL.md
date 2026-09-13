---
name: team-run
description: Run the universal senior engineering team workflow.
---

# Team Run

Use this skill when the user asks to implement, fix, refactor, debug, migrate, or otherwise complete an engineering task.

## Protocol

### Phase 0 — Intake
Understand the desired outcome, constraints, acceptance criteria, and risk.

### Phase 1 — Repository scan
Inspect structure, package scripts, CI, tests, docs, relevant modules, and existing implementations.

### Phase 2 — Specification
For non-trivial work, specify first: use Spec Kit when installed
(constitution → specify → clarify → plan → checklist → tasks → analyze),
otherwise a lightweight spec (outcome, constraints, acceptance criteria,
task graph).

### Phase 3 — Delegation
Build a dependency graph. Spawn independent research/design/implementation/test tasks in parallel.

### Phase 4 — Implementation
Implement only assigned scope. Prefer isolated worktrees for overlapping edits.

### Phase 5 — Integration
Merge/integrate carefully. Resolve conflicts semantically, not mechanically.

### Phase 6 — Verification
Run formatting, lint, typecheck/build, focused tests, broader regression tests, and E2E when applicable.

### Phase 7 — Adversarial review
Use independent reviewer, security reviewer, and performance reviewer.

### Phase 8 — Convergence
Any finding becomes a corrective task. Fix and rerun verification. Repeat.

### Phase 9 — Final gate
Final verifier must independently establish evidence for every requirement.

### Progress reports

Emit concise reports at:
- intake complete
- plan complete
- implementation batches complete
- integration complete
- test complete
- review complete
- convergence complete
- final result

Use this format:

STATUS: <phase>
DONE: <facts>
EVIDENCE: <commands/files/results>
FINDINGS: <issues or none>
NEXT: <next action>
