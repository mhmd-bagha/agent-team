#!/usr/bin/env bash
# Jev diagnostics: reports configuration, readiness, and connectivity.
# Never prints the API key value. Follows the conventions of scripts/report.sh.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
POLICY="$ROOT/config/team-policy.json"

enabled="${JEV_ENABLED:-}"
endpoint="${JEV_ENDPOINT:-}"
model="${JEV_MODEL:-}"
timeout_ms="${JEV_TIMEOUT_MS:-}"

file_values="$(node -e '
  const fs = require("fs");
  try {
    const p = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const j = p.jev || {};
    console.log(JSON.stringify({
      enabled: j.enabled ?? true,
      endpoint: j.endpoint ?? "",
      model: j.model ?? "",
      timeoutMs: j.timeoutMs ?? 1000,
    }));
  } catch (e) {
    console.log(JSON.stringify({ error: String(e && e.message || e) }));
  }
' "$POLICY")"

eval_enabled="$(node -e '
  const f = JSON.parse(process.argv[1]);
  const env = process.env.JEV_ENABLED;
  const enabled = env !== undefined ? !["0","false","no","off"].includes(env.trim().toLowerCase()) : f.enabled;
  console.log(enabled ? "yes" : "no");
' "$file_values")"

eval_endpoint="$(node -e '
  const f = JSON.parse(process.argv[1]);
  console.log(process.env.JEV_ENDPOINT || f.endpoint || "(not set)");
' "$file_values")"

eval_model="$(node -e '
  const f = JSON.parse(process.argv[1]);
  console.log(process.env.JEV_MODEL || f.model || "(not set)");
' "$file_values")"

eval_timeout="$(node -e '
  const f = JSON.parse(process.argv[1]);
  console.log(process.env.JEV_TIMEOUT_MS || f.timeoutMs || 1000);
' "$file_values")"

if [[ -n "${JEV_API_KEY:-}" ]]; then api_key="yes"; else api_key="no"; fi

# Connectivity: only when fully configured; bounded by the configured timeout.
connectivity="skipped (not configured)"
latency="n/a"
if [[ "$eval_enabled" == "yes" && "$eval_endpoint" != "(not set)" && "$eval_model" != "(not set)" && "$api_key" == "yes" ]]; then
  probe="$(node -e '
    (async () => {
      const endpoint = process.env.JEV_ENDPOINT;
      const started = Date.now();
      const timeoutMs = Number(process.env.JEV_TIMEOUT_MS || 1000);
      const c = new AbortController();
      const t = setTimeout(() => c.abort(), timeoutMs);
      try {
        const r = await fetch(endpoint.replace(/\/+$/, "") + "/v1/decide", {
          method: "POST",
          headers: { "content-type": "application/json", authorization: "Bearer REDACTED-PROBE" },
          body: JSON.stringify({ model: process.env.JEV_MODEL, requestId: "doctor-probe", caller: "doctor", questions: [] }),
          signal: c.signal,
        });
        // Any HTTP response (even 401) proves the endpoint is reachable.
        console.log(JSON.stringify({ ok: true, latencyMs: Date.now() - started, status: r.status }));
      } catch (e) {
        console.log(JSON.stringify({ ok: false, error: String((e && e.name) || e) }));
      } finally {
        clearTimeout(t);
      }
    })();
  ' 2>/dev/null || echo '{"ok":false,"error":"probe-failed"}')"
  connectivity="$(echo "$probe" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const p=JSON.parse(s);console.log(p.ok?"pass":"fail")}catch{console.log("fail")}})')"
  latency="$(echo "$probe" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const p=JSON.parse(s);console.log(p.latencyMs!==undefined?p.latencyMs+"ms":"n/a")}catch{console.log("n/a")}})')"
  _="$enabled $endpoint $model $timeout_ms"
fi

# Config validity via the compiled loader when available, else JSON syntax.
config_valid="valid"
if [[ -f "$ROOT/dist/jev/config.js" ]]; then
  if ! node -e '
    const { loadJevConfig } = require(process.argv[1]);
    const fs = require("fs");
    const p = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
    loadJevConfig(p.jev || {}, process.env);
  ' "$ROOT/dist/jev/config.js" "$POLICY" 2>/dev/null; then
    config_valid="invalid (see loader error above)"
  fi
else
  if ! node -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))' "$POLICY" 2>/dev/null; then
    config_valid="invalid JSON"
  fi
fi

cat <<EOF
Jev enabled: $eval_enabled
Endpoint configured: $([[ "$eval_endpoint" != "(not set)" ]] && echo yes || echo no)
API key configured: $api_key
Model configured: $([[ "$eval_model" != "(not set)" ]] && echo yes || echo no)
Timeout (ms): $eval_timeout
Connectivity: $connectivity
Latency: $latency
Configuration: $config_valid
EOF
