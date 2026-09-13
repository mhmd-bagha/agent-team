#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET="${1:-.}"

mkdir -p "$TARGET/.claude/agents" "$TARGET/.claude/skills/team-run" "$TARGET/.claude/skills/final-verification"

cp "$ROOT/TEAM.md" "$TARGET/TEAM.md"
cp "$ROOT/.claude/CLAUDE.md" "$TARGET/.claude/CLAUDE.md"
cp "$ROOT/.claude/agents/"*.md "$TARGET/.claude/agents/"
cp "$ROOT/.claude/skills/team-run/SKILL.md" "$TARGET/.claude/skills/team-run/SKILL.md"
cp "$ROOT/.claude/skills/final-verification/SKILL.md" "$TARGET/.claude/skills/final-verification/SKILL.md"

echo "Installed Universal Agent Team into: $TARGET"
echo
echo "Enable Claude Agent Teams:"
echo '  export CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1'
echo
echo "Then:"
echo '  claude'
