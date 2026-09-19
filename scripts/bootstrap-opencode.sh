#!/usr/bin/env bash
set -euo pipefail

# Install the Universal Agent Team as OpenCode skills + agents.
#
#   ./scripts/bootstrap-opencode.sh /path/to/project   # project -> <project>/.opencode
#   ./scripts/bootstrap-opencode.sh --global            # global  -> ~/.config/opencode (all sessions)
#
# Discovery (see https://opencode.ai/docs/skills/ and /docs/agents/):
# skills:  <project>/.opencode/skills/<name>/SKILL.md (project rank)
#          ~/.config/opencode/skills/<name>/SKILL.md  (global rank)
#          (OpenCode also reads ~/.claude/skills and ~/.agents/skills.)
# agents:  <project>/.opencode/agents/<role>.md (project rank)
#          ~/.config/opencode/agents/<role>.md  (global rank)
# Role prompts ship as skill resources under team-run/ too, so delegating
# prompts can point subagents at them on any runner.
#
# Note: OpenCode loads skills/agents at session start. Running sessions pick
# up the update on reload; new sessions get it automatically.

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODE="project"
TARGET="."

print_usage() {
  echo "Usage:"
  echo "  bootstrap-opencode.sh /path/to/project   # project skills+agents -> <project>/.opencode"
  echo "  bootstrap-opencode.sh --global            # global skills+agents  -> ~/.config/opencode"
}

if [[ "${1:-}" == "--global" ]]; then
  MODE="global"
  TARGET="${HOME:?HOME must be set}/.config/opencode"
elif [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  print_usage
  exit 0
elif [[ $# -ge 1 ]]; then
  if [[ "$1" == --* ]]; then
    echo "Unknown flag: $1" >&2
    print_usage >&2
    exit 2
  fi
  TARGET="$1"
fi

if [[ "$MODE" == "global" ]]; then
  DEST="$TARGET"
else
  DEST="$TARGET/.opencode"
fi

mkdir -p "$DEST/skills/team-run/agents" "$DEST/skills/final-verification" "$DEST/agents"

cp "$ROOT/.claude/skills/team-run/SKILL.md" "$DEST/skills/team-run/SKILL.md"
cp "$ROOT/.claude/skills/final-verification/SKILL.md" "$DEST/skills/final-verification/SKILL.md"

shopt -s nullglob
agent_files=("$ROOT/.claude/agents/"*.md)
shopt -u nullglob
if [[ ${#agent_files[@]} -eq 0 ]]; then
  echo "No agent prompts found in $ROOT/.claude/agents/" >&2
  exit 1
fi
cp "${agent_files[@]}" "$DEST/skills/team-run/agents/"
cp "${agent_files[@]}" "$DEST/agents/"
cp "$ROOT/TEAM.md" "$DEST/skills/team-run/TEAM.md"
cp "$ROOT/config/team-policy.json" "$DEST/skills/team-run/team-policy.json"
cp "$ROOT/docs/JEV.md" "$DEST/skills/team-run/JEV.md"
mkdir -p "$DEST/skills/team-run/memory"
if [[ ! -f "$DEST/skills/team-run/memory/MEMORY.md" ]]; then
  cp "$ROOT/memory/MEMORY.md" "$DEST/skills/team-run/memory/MEMORY.md"
fi

echo "Installed Universal Agent Team skills+agents into: $DEST"
if [[ "$MODE" == "project" ]]; then
  echo "OpenCode discovers them automatically for sessions in: $TARGET"
else
  echo "OpenCode discovers them automatically in every session (user-global)."
  echo "Running sessions pick them up on reload."
fi
