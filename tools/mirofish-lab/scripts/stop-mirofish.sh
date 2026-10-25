#!/usr/bin/env bash
# Stop the MiroFish backend started by setup-mirofish.sh.
set -euo pipefail

MIROFISH_HOME="${MIROFISH_HOME:-$HOME/MiroFish}"
PID_FILE="$MIROFISH_HOME/.mirofish-lab/backend.pid"

if [ ! -f "$PID_FILE" ]; then
  printf 'No PID file at %s\n' "$PID_FILE"
  exit 0
fi

PID="$(cat "$PID_FILE")"
if kill -0 "$PID" 2>/dev/null; then
  kill "$PID"
  i=0
  while [ "$i" -lt 20 ]; do
    kill -0 "$PID" 2>/dev/null || break
    i=$((i + 1))
    sleep 0.5
  done
  if kill -0 "$PID" 2>/dev/null; then
    printf 'Process %s did not stop; inspect it before forcing.\n' "$PID" >&2
    exit 1
  fi
  printf 'Stopped MiroFish backend (pid %s)\n' "$PID"
else
  printf 'Process %s is not running\n' "$PID"
fi
rm -f "$PID_FILE"
