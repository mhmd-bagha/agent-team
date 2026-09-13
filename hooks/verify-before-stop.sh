#!/usr/bin/env bash
set -euo pipefail

# This hook is intentionally conservative. It does not attempt to guess the project's
# test command. The agent must provide verification evidence in its final report.
# Projects can replace this script with repository-specific checks.

if [[ -f package.json ]]; then
  node -e '
    const p=require("./package.json");
    const scripts=p.scripts||{};
    const checks=["lint","typecheck","test","build"];
    console.log("Available verification scripts:", checks.filter(x=>scripts[x]).join(", ")||"none");
  '
fi
