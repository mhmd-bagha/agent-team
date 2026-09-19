---
name: final-verification
description: Independently verify requirements, tests, diff hygiene, and residual risk.
---

# Final Verification

Never trust previous agent summaries without checking evidence.

Create a requirement-to-evidence matrix:

| Requirement | Implementation | Verification | Status |
|---|---|---|---|

Then inspect the final diff and run the repository's relevant checks.

Jev verification signals (if the project uses `jev/`, see `docs/JEV.md`) are
advisory only: a `readyForFinalVerification=true` vote never substitutes for
the matrix above. Evidence remains mandatory; when Jev is disabled or
uncertain, verify directly from requirements, diff, and checks.

Verdict:

- CONVERGED: all mandatory gates pass and no material unresolved risk.
- BLOCKED: a mandatory gate cannot pass due to an external or authorization blocker.
- NOT CONVERGED: work remains.

Never use "100% bug-free" as a claim.
