# Portable provider contract

Any agent runner can participate if it can:

1. receive a complete task prompt
2. inspect the repository
3. edit its assigned scope
4. run commands
5. return a structured report

Recommended mapping:

- ACP-capable agent → spawn through ACP
- Codex-compatible agent → use its native app/server integration
- Claude Code → native Agent Teams/subagents
- DeepSeek Harness → dsh-subagent/workflow
- Kimi/KUN/other skill-based agent → install the skills and invoke the equivalent commands

The engineering contract remains provider-neutral.
