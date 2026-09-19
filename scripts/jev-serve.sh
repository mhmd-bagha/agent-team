#!/usr/bin/env bash
# Run the local Jev decision server (loopback only).
# Configuration lives OUTSIDE the repo in ~/.config/agent-team/jev.env
# (mode 600, never committed):
#
#   JEV_PORT=3819
#   JEV_PROVIDER_ENDPOINT=https://api.deepseek.com   # OpenAI-compatible
#   JEV_PROVIDER_API_KEY=<secret>
#   JEV_PROVIDER_MODEL=deepseek-chat
#   # JEV_MODEL falls back to JEV_PROVIDER_MODEL
#
# Without provider vars the server runs the deterministic fake backend
# (safe for offline use; all callers still get typed decisions).
# Client side: JEV_ENDPOINT=http://127.0.0.1:3819 JEV_MODEL=<logical> JEV_API_KEY=local
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${JEV_ENV_FILE:-$HOME/.config/agent-team/jev.env}"

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

if [[ ! -f "$ROOT/dist/jev/serve.js" ]]; then
  echo "Building jev/ first..." >&2
  (cd "$ROOT" && npm run build >&2)
fi

exec node "$ROOT/dist/jev/serve.js"
