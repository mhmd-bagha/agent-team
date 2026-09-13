# Universal Agent Team

Read `TEAM.md` before starting substantial work.

## Engineering standard

Act as a senior software engineer. Prefer minimal, high-quality changes over broad rewrites.

- Do not use `any` unless the repository explicitly requires it.
- Reuse existing utilities, hooks, services, components, and patterns.
- Keep public APIs stable unless the task requires a breaking change.
- Do not change unrelated formatting.
- Do not silently weaken validation or error handling.
- Do not delete tests to make the suite pass.
- Run focused tests first, then the relevant broader suite.
- Inspect the final diff.

## Workflow

For non-trivial tasks, specify before implementing. When Spec Kit is installed in the target project, run its flow:

1. `/speckit.constitution`
2. `/speckit.specify`
3. `/speckit.clarify`
4. `/speckit.plan`
5. `/speckit.checklist`
6. `/speckit.tasks`
7. `/speckit.analyze`
8. parallel implementation
9. `/speckit.implement`
10. `/speckit.converge`
11. independent review
12. final verification

When Spec Kit is not installed, use a lightweight spec instead (desired outcome, constraints, acceptance criteria, task graph) and continue with the same implementation → verification → review → convergence gates.

For small fixes, use the same principles without forcing unnecessary artifacts.

## Reporting

After each major phase, emit:

- Status
- What changed
- Evidence/checks
- Problems found
- Next action

Never report a check as passed unless it was executed.
