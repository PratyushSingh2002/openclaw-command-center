#!/usr/bin/env bash
set -euo pipefail

payload="$(cat)"
if [[ -z "${payload}" ]]; then
  printf '{"error":"No JSON payload received on stdin."}\n'
  exit 1
fi

readarray -t parsed < <(python3 - <<'PY' "${payload}"
import json
import sys

payload = json.loads(sys.argv[1])
message = payload.get("message", "")
is_slash = "1" if payload.get("isSlashCommand") else "0"
history = json.dumps(payload.get("history", []))

print(message)
print(is_slash)
print(history)
PY
)

OPENCLAW_MESSAGE="${parsed[0]:-}"
OPENCLAW_IS_SLASH_COMMAND="${parsed[1]:-0}"
OPENCLAW_HISTORY_JSON="${parsed[2]:-[]}"
export OPENCLAW_MESSAGE OPENCLAW_IS_SLASH_COMMAND OPENCLAW_HISTORY_JSON

if [[ "$#" -eq 0 ]]; then
  printf '{"error":"No downstream command supplied.","hint":"Call this helper with the real adapter command appended, or point the extension directly at your own script."}\n'
  exit 1
fi

exec "$@" <<<"${payload}"
