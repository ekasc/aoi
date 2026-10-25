# Local OASIS mode

This folder runs **MiroFish’s upstream OASIS Reddit runner** without MiroFish’s Flask API and without Zep. It is the free, no-graph path.

`run_oasis.py` does three things:

1. invokes `$MIROFISH_HOME/backend/scripts/run_reddit_simulation.py` with the generated two-person profiles and config;
2. reads `reddit_simulation.db`;
3. writes raw posts/comments to `oasis-raw.json`, which the Node adapter turns into the normal lab bundle.

It does not import or call Zep. It does not modify the MiroFish checkout.

## Setup

On any macOS or Linux host:

```sh
pnpm mirofish-lab:proxy            # required for OpenCode Go's x-opencode-session header

export LLM_API_KEY='...'          # or OPENCODE_GO_API_KEY
export LLM_BASE_URL='http://127.0.0.1:5051/v1'
export LLM_MODEL_NAME='deepseek-v4.1-flash'

tools/mirofish-lab/scripts/setup-mirofish.sh
```

The setup script clones MiroFish, installs its Python dependencies, and skips starting the MiroFish server when `ZEP_API_KEY` is absent. OASIS mode only needs the checkout and dependencies.

If you already have a checkout:

```sh
export MIROFISH_HOME="$HOME/MiroFish"
```

## Run

```sh
pnpm mirofish-lab:oasis -- --rounds 2 --couples couple-01
```

`--couples` accepts comma-separated couple ids from `personas/personas.v1.json`. Each couple runs as exactly two OASIS agents, so a conversation never mixes members of different Aoi spaces.

Reduce cost while testing:

```sh
pnpm mirofish-lab:oasis -- --rounds 1 --couples couple-01
```

A real run needs an OpenAI-compatible model endpoint. Without `LLM_API_KEY`/`OPENCODE_GO_API_KEY`, the command exits 2 and writes no fixture. The generated bundle is labelled `local_oasis` and explicitly says it is **not a MiroFish/Zep run**.

## Limits

OASIS is a Reddit-like social feed. The prompt frames each couple as a private two-person discussion, but it is still not Aoi’s UI. This mode has no graph profiles, Report Agent, or MiroFish report. It is useful for free discussion and scenario discovery, not for reproducing MiroFish’s graph features.

OASIS is Apache 2.0. MiroFish is AGPL-3.0; keep its checkout separate from Aoi.
