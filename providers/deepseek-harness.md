# DeepSeek Harness provider mapping

DeepSeek Harness supports a subagent capability with multiple providers and a workflow engine.

Map this team's roles as follows:

- team-lead: root/implicit-root agent
- architect/researcher/reviewer/test/security/performance: delegated subagents
- implementer: scoped subagent or Claude Code child
- final-verifier: independent child session
- workflow: orchestration script when durable multi-step execution is desired

Prefer background execution for independent research/verification tasks. Collect results before integration.

## Skill discovery (verified against installed Harness 0.3.5)

`@deepseek-ai/dsh-skill-filesystem` scans these roots for skills
(directory bundles `<name>/SKILL.md`, or flat `<name>.md` files):

1. `<project>/.dsh/skills` (project rank)
2. `<project>/.agents/skills` (project rank)
3. custom skill dirs (when configured)
4. `${DSH_HOME:-~/.dsh}/skills` (user-global rank)
5. `${DSH_AGENTS_HOME:-~/.agents}/skills` (user-global rank)
6. bundled skill dir (when configured)

Each `SKILL.md` needs YAML frontmatter with at least `name`
(lowercase kebab-case) and `description`. Bodies load on demand, with
the skill directory as resource base.

Install with `./scripts/bootstrap-dsh.sh <project>` (project skills)
or `./scripts/bootstrap-dsh.sh --global` (user-global skills).
Role prompts ship as resources under `team-run/` (`TEAM.md`,
`team-policy.json`, `agents/*.md`); the skill body tells the delegating
agent how to point subagents at them.

Workspace instructions load from `AGENTS.md` / `CLAUDE.md` (project and
nested scopes) plus `$DSH_HOME/AGENTS.md` (user-global).

Do not assume other provider-specific flags that vary by Harness release.
Inspect the installed Harness documentation/help and map the generic
contract in `TEAM.md`.

The team contract requires:
- explicit task scope
- explicit dependencies
- structured report
- exact verification evidence
- convergence after failures
