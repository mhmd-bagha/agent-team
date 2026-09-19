#!/usr/bin/env bash
set -euo pipefail

# Install the Universal Agent Team as DeepSeek Harness skills.
#
#   ./scripts/bootstrap-dsh.sh /path/to/project   # project skills -> <project>/.dsh/skills
#   ./scripts/bootstrap-dsh.sh --global            # global skills  -> ${DSH_HOME:-~/.dsh}/skills
#
# Discovery (see providers/deepseek-harness.md and dsh-skill-filesystem):
# DSH scans <project>/.dsh/skills and ${DSH_HOME:-~/.dsh}/skills for
# <skill-name>/SKILL.md bundles with name+description frontmatter.
# Role prompts ship as skill resources under team-run/ so delegating
# prompts can point subagents at them.
#
# Note: DSH_HOME already points at the .dsh dir itself, so the global
# TARGET is DSH_HOME verbatim; only the HOME fallback appends /.dsh.

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODE="project"
TARGET="."

print_usage() {
  echo "Usage:"
  echo "  bootstrap-dsh.sh /path/to/project   # project skills -> <project>/.dsh/skills"
  echo "  bootstrap-dsh.sh --global            # global skills  -> DSH_HOME/skills"
}

if [[ "${1:-}" == "--global" ]]; then
  MODE="global"
  TARGET="${DSH_HOME:-${HOME:?HOME must be set (or export DSH_HOME)}/.dsh}"
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
  DEST="$TARGET/skills"
else
  DEST="$TARGET/.dsh/skills"
fi

mkdir -p "$DEST/team-run/agents" "$DEST/final-verification"

cp "$ROOT/.claude/skills/team-run/SKILL.md" "$DEST/team-run/SKILL.md"
cp "$ROOT/.claude/skills/final-verification/SKILL.md" "$DEST/final-verification/SKILL.md"

shopt -s nullglob
agent_files=("$ROOT/.claude/agents/"*.md)
shopt -u nullglob
if [[ ${#agent_files[@]} -eq 0 ]]; then
  echo "No agent prompts found in $ROOT/.claude/agents/" >&2
  exit 1
fi
cp "${agent_files[@]}" "$DEST/team-run/agents/"
cp "$ROOT/TEAM.md" "$DEST/team-run/TEAM.md"
cp "$ROOT/config/team-policy.json" "$DEST/team-run/team-policy.json"
cp "$ROOT/docs/JEV.md" "$DEST/team-run/JEV.md"
mkdir -p "$DEST/team-run/memory"
if [[ ! -f "$DEST/team-run/memory/MEMORY.md" ]]; then
  cp "$ROOT/memory/MEMORY.md" "$DEST/team-run/memory/MEMORY.md"
fi

echo "Installed Universal Agent Team skills into: $DEST"
if [[ "$MODE" == "project" ]]; then
  echo "DSH discovers them automatically for sessions in: $TARGET"
else
  echo "DSH discovers them automatically in every session (user-global skills)."
fi
