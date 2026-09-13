# Workflow details

## Parallelism

Parallelize only tasks whose read/write sets do not conflict and whose outputs do not form a dependency chain.

Example:

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

## Worktree policy

Use one worktree per implementation agent when:
- two agents can touch the same directory
- a task is large enough to benefit from independent review
- a branch/commit boundary is useful

A shared checkout is acceptable for read-only agents and strictly disjoint file ownership.

## Confidence

The target is >= 0.95 evidence-backed confidence, not a fabricated probability.

Suggested scoring:

- requirements coverage: 25%
- implementation correctness: 20%
- automated verification: 25%
- independent review: 10%
- security: 10%
- performance/regression: 10%

A single critical security/correctness finding overrides the score and blocks convergence.

## Reporting

Reports should be short enough to follow but concrete enough to audit. Link claims to:
- file paths
- commits/diffs
- command output
- test names
- requirement IDs
