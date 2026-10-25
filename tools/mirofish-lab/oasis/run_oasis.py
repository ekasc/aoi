#!/usr/bin/env python3
"""Run MiroFish's upstream OASIS Reddit runner without MiroFish's Zep layer.

This wrapper is intentionally small. It invokes the checked-out MiroFish
script `backend/scripts/run_reddit_simulation.py`, then reads the resulting
SQLite database and writes a raw JSON file for the Node adapter.

It does not import Zep, does not call the MiroFish Flask API, and does not
invent observations. If OASIS or the model fails, it exits nonzero.
"""

from __future__ import annotations

import argparse
import json
import os
import sqlite3
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path


def fail(message: str) -> None:
    print(f"oasis runner: {message}", file=sys.stderr)
    raise SystemExit(1)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--profiles", required=True)
    parser.add_argument("--config", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--couple-id", required=True)
    parser.add_argument("--group", default="A")
    parser.add_argument("--rounds", type=int, default=4)
    parser.add_argument("--timeout", type=int, default=1200)
    args = parser.parse_args()

    profiles_path = Path(args.profiles).resolve()
    config_path = Path(args.config).resolve()
    out_path = Path(args.out).resolve()
    out_path.parent.mkdir(parents=True, exist_ok=True)

    if not profiles_path.exists():
        fail(f"missing profiles file: {profiles_path}")
    if not config_path.exists():
        fail(f"missing config file: {config_path}")

    mirofish_home = Path(
        os.environ.get("MIROFISH_HOME", Path.home() / "MiroFish")
    )
    runner = mirofish_home / "backend" / "scripts" / "run_reddit_simulation.py"
    if not runner.exists():
        fail(
            f"upstream OASIS runner not found at {runner}. "
            "Set MIROFISH_HOME to a MiroFish checkout (the setup script clones one)."
        )

    for name in ("LLM_API_KEY", "LLM_BASE_URL", "LLM_MODEL_NAME"):
        if not os.environ.get(name):
            fail(f"{name} is not set. OASIS needs an OpenAI-compatible model endpoint.")

    profiles = json.loads(profiles_path.read_text(encoding="utf-8"))
    if not isinstance(profiles, list) or len(profiles) != 2:
        fail("OASIS profiles must contain exactly two people for an Aoi space")
    agent_map = {
        str(index): profile["persona_id"] for index, profile in enumerate(profiles)
    }

    simulation_dir = config_path.parent
    db_path = simulation_dir / "reddit_simulation.db"
    if db_path.exists():
        db_path.unlink()

    started_at = datetime.now(timezone.utc).isoformat()
    command = [
        sys.executable,
        str(runner),
        "--config",
        str(config_path),
        "--no-wait",
        "--max-rounds",
        str(args.rounds),
    ]
    try:
        completed = subprocess.run(
            command,
            cwd=str(simulation_dir),
            env=os.environ.copy(),
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            timeout=args.timeout,
        )
    except subprocess.TimeoutExpired:
        fail(f"OASIS timed out after {args.timeout}s")
    finished_at = datetime.now(timezone.utc).isoformat()

    log_path = simulation_dir / "oasis.log"
    log_path.write_text(completed.stdout or "", encoding="utf-8")
    if completed.returncode != 0:
        tail = (completed.stdout or "")[-2000:]
        print(tail, file=sys.stderr)
        fail(f"OASIS exited with {completed.returncode}; see {log_path}")

    if not db_path.exists():
        fail(f"OASIS did not create {db_path}; see {log_path}")

    connection = sqlite3.connect(db_path)
    connection.row_factory = sqlite3.Row
    try:
        posts = [
            {
                "agent_id": row["user_id"],
                "content": row["content"],
                "created_at": row["created_at"],
            }
            for row in connection.execute(
                "select user_id, content, created_at from post "
                "where content is not null and length(trim(content)) > 0 "
                "order by post_id"
            )
        ]
        comments = [
            {
                "agent_id": row["user_id"],
                "post_id": row["post_id"],
                "content": row["content"],
                "created_at": row["created_at"],
            }
            for row in connection.execute(
                "select user_id, post_id, content, created_at from comment "
                "where content is not null and length(trim(content)) > 0 "
                "order by comment_id"
            )
        ]
    finally:
        connection.close()

    payload = {
        "schemaVersion": "aoi-oasis-raw/1",
        "simulation_id": f"oasis-{args.couple_id}-{args.group}-{int(time.time())}",
        "couple_id": args.couple_id,
        "group": args.group,
        "model": os.environ["LLM_MODEL_NAME"],
        "rounds": args.rounds,
        "started_at": started_at,
        "finished_at": finished_at,
        "agent_map": agent_map,
        "posts": posts,
        "comments": comments,
    }
    out_path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(
        json.dumps(
            {
                "ok": True,
                "out": str(out_path),
                "posts": len(posts),
                "comments": len(comments),
            }
        )
    )


if __name__ == "__main__":
    main()
