#!/usr/bin/env bash
set -euo pipefail

phase="${1:-unknown}"
status="${2:-UNKNOWN}"
done_msg="${3:-}"
evidence="${4:-}"
findings="${5:-none}"
next="${6:-}"

cat <<EOF
STATUS: $phase
DONE: $done_msg
EVIDENCE: $evidence
FINDINGS: $findings
NEXT: $next
EOF
