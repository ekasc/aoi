#!/usr/bin/env bash
# Prepare and start MiroFish on the host where you want to run simulations.
#
# Works on macOS or Linux. It creates a separate MiroFish checkout, binds the
# API to loopback only, and never prints credential values.
set -euo pipefail

MIROFISH_HOME="${MIROFISH_HOME:-$HOME/MiroFish}"
MIROFISH_REF="${MIROFISH_REF:-7657031ac01184afe2cb220f5ee3545573b5e843}"
MIROFISH_PORT="${MIROFISH_PORT:-5001}"
MIROFISH_LOG_DIR="${MIROFISH_LOG_DIR:-$MIROFISH_HOME/.mirofish-lab}"
MIROFISH_PID_FILE="$MIROFISH_LOG_DIR/backend.pid"

say() { printf '%s\n' "$*"; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }

command -v git >/dev/null || die "git is required"
command -v uv >/dev/null || die "uv is required (https://docs.astral.sh/uv/)"
command -v curl >/dev/null || die "curl is required"

if [ ! -d "$MIROFISH_HOME/.git" ]; then
  say "Cloning MiroFish into $MIROFISH_HOME"
  mkdir -p "$(dirname "$MIROFISH_HOME")"
  git clone https://github.com/666ghj/MiroFish.git "$MIROFISH_HOME"
fi

git -C "$MIROFISH_HOME" fetch --quiet origin
git -C "$MIROFISH_HOME" checkout --quiet "$MIROFISH_REF"
say "MiroFish checkout: $(git -C "$MIROFISH_HOME" rev-parse HEAD)"

if [ -z "${LLM_API_KEY:-}" ] && [ -n "${OPENCODE_GO_API_KEY:-}" ]; then
  LLM_API_KEY="$OPENCODE_GO_API_KEY"
fi

if [ -z "${LLM_API_KEY:-}" ]; then
  die "No model key found. Add OPENCODE_KEY=... to the repo .env and run 'pnpm mirofish -- --live', or export LLM_API_KEY in this shell."
fi
if [ -z "${ZEP_API_KEY:-}" ]; then
  say "ZEP_API_KEY is not set: MiroFish server mode will be unavailable, but OASIS mode does not need Zep."
fi
LLM_BASE_URL="${LLM_BASE_URL:-http://127.0.0.1:5051/v1}"
LLM_MODEL_NAME="${LLM_MODEL_NAME:-deepseek-v4.1-flash}"

if [ "$LLM_BASE_URL" = "http://127.0.0.1:5051/v1" ] && ! curl -fsS "http://127.0.0.1:5051/health" >/dev/null 2>&1; then
  say "warning: the OpenCode Go proxy is not running. Start 'pnpm mirofish-lab:proxy' before inference."
fi

mkdir -p "$MIROFISH_LOG_DIR"
umask 077
{
  printf 'LLM_API_KEY=%s\n' "$LLM_API_KEY"
  printf 'LLM_BASE_URL=%s\n' "$LLM_BASE_URL"
  printf 'LLM_MODEL_NAME=%s\n' "$LLM_MODEL_NAME"
  if [ -n "${ZEP_API_KEY:-}" ]; then
    printf 'ZEP_API_KEY=%s\n' "$ZEP_API_KEY"
  fi
  printf 'FLASK_HOST=127.0.0.1\n'
  printf 'FLASK_PORT=%s\n' "$MIROFISH_PORT"
  printf 'FLASK_DEBUG=false\n'
  printf 'OASIS_DEFAULT_MAX_ROUNDS=%s\n' "${OASIS_DEFAULT_MAX_ROUNDS:-12}"
} > "$MIROFISH_HOME/.env"
chmod 600 "$MIROFISH_HOME/.env"
say "Wrote $MIROFISH_HOME/.env with mode 600 (values not printed)"

say "Installing backend dependencies with uv (MiroFish needs Python >=3.11,<3.13; uv can install one)"
(cd "$MIROFISH_HOME/backend" && uv sync)

if [ -z "${ZEP_API_KEY:-}" ]; then
  say "Skipping MiroFish server start (no ZEP_API_KEY). OASIS is ready to use."
  exit 0
fi

if [ -f "$MIROFISH_PID_FILE" ] && kill -0 "$(cat "$MIROFISH_PID_FILE")" 2>/dev/null; then
  say "MiroFish backend already running (pid $(cat "$MIROFISH_PID_FILE"))"
else
  say "Starting MiroFish backend on 127.0.0.1:$MIROFISH_PORT"
  (
    cd "$MIROFISH_HOME/backend"
    nohup uv run python run.py > "$MIROFISH_LOG_DIR/backend.log" 2>&1 &
    echo $! > "$MIROFISH_PID_FILE"
  )
fi

i=0
while [ "$i" -lt 60 ]; do
  if curl -fsS "http://127.0.0.1:$MIROFISH_PORT/health" >/dev/null 2>&1; then
    say "MiroFish health: ok"
    say "Log: $MIROFISH_LOG_DIR/backend.log"
    say "MiroFish is licensed AGPL-3.0; keep this checkout separate from Aoi."
    exit 0
  fi
  i=$((i + 1))
  sleep 2
done

die "MiroFish did not become healthy. Inspect $MIROFISH_LOG_DIR/backend.log"
