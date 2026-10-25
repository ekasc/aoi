# Aoi × MiroFish simulation lab

A development-only lab that explores fictional Aoi user behavior, turns the useful parts into test scenarios, checks those against Aoi’s existing tests, and runs the supported ones through Aoi’s harness.

It is not part of the app, does not talk to production, and does not treat a simulated user’s claim as a bug.

Runs on macOS or Linux. No host is assumed.

## Start here

```sh
pnpm mirofish
```

That opens a short menu. If you just want to see it work:

```sh
pnpm mirofish -- --demo
```

The demo needs no keys, no Python, and no network. It takes about ten seconds, extracts 19 scenarios, runs six through Aoi’s tests, and writes:

```text
tools/mirofish-lab/reports/latest.md
```

To check what is ready:

```sh
pnpm mirofish -- --check
```

## Three modes

| Mode | Command | Needs | What it does |
| --- | --- | --- | --- |
| Offline demo | `pnpm mirofish -- --demo` | nothing | Uses a clearly labelled fixture. Demonstrates the whole pipeline. |
| Local OASIS | `pnpm mirofish -- --live` | an LLM key | Runs real OASIS discussions, two fictional people per couple. No Zep. |
| MiroFish server | `pnpm mirofish -- --mirofish` | an LLM key + Zep | Runs the full MiroFish API, graph, and report. Advanced. |

The demo is not a simulation. The report says so.

## Local OASIS, step by step

OASIS is the social-simulation engine inside MiroFish. This mode runs it directly, without MiroFish’s Flask API or Zep.

### 1. Start the OpenCode Go proxy

OpenCode Go requires `x-opencode-session` and a real client User-Agent on every request. MiroFish and Camel do not send them, so the lab includes a loopback proxy.

```sh
pnpm mirofish-lab:proxy
```

Leave it running. It listens on `127.0.0.1:5051` only.

### 2. Set your key

```sh
export OPENCODE_GO_API_KEY='...'
export LLM_API_KEY="$OPENCODE_GO_API_KEY"
export LLM_BASE_URL='http://127.0.0.1:5051/v1'
export LLM_MODEL_NAME='deepseek-v4.1-flash'
```

Any OpenAI-compatible provider works. If you are not using OpenCode Go, set `LLM_BASE_URL` to that provider and skip the proxy.

### 3. Run

```sh
pnpm mirofish -- --live --rounds 1 --couples couple-01
```

The first live run offers to clone MiroFish and install its Python dependencies. Say yes once. Later runs skip that.

Start with one couple and one round. Then expand:

```sh
pnpm mirofish -- --live --rounds 2 --couples couple-01,couple-02

# Every couple, every experiment group (54 conversations)
pnpm mirofish -- --live --full --rounds 2
```

## What happens in a run

```text
Aoi source + docs
  → curated seed documents
  → fictional personas
  → OASIS or MiroFish discussion
  → strict scenarios
  → coverage check against Aoi tests
  → supported scenarios executed
  → report
```

Every scenario records:

- the Aoi commit and simulation id,
- the observations that produced it,
- relevant source files,
- what the code does,
- what the product documents say,
- what a fictional user believed,
- whether any test actually passed or failed.

A scenario starts as a **hypothesis**. Only an executed test can make it a reproduced defect.

## Commands you actually need

```sh
pnpm mirofish                  # menu
pnpm mirofish -- --demo        # offline end-to-end
pnpm mirofish -- --live        # local OASIS
pnpm mirofish -- --check       # what is ready
pnpm mirofish -- --report      # latest report summary
```

Advanced commands are still available:

```sh
pnpm mirofish-lab:test         # tests for the lab itself
pnpm mirofish-lab:check        # validate seeds, personas, scenarios
pnpm mirofish-lab:coverage     # re-run the coverage analyzer
pnpm mirofish-lab:execute      # execute mapped scenarios
pnpm mirofish-lab:proxy        # OpenCode Go header proxy
```

## Current evidence

- A complete local OASIS run through OpenCode Go has now run: 9 couples × 6 experiment groups × 2 rounds = 54 conversations, using the header proxy and no Zep.
- That run produced 137 scenarios from 17 of 19 templates. The theoretical ceiling with the current 9 couples × 19 templates is 171; not every conversation raises every template.
- Coverage: 16 covered, 69 partial, 52 not automatable. Five representative executable templates ran through Aoi’s harness and passed.
- The offline demo produces 19 scenarios across all six experiment groups; six execute through Aoi’s real Hono/D1 harness or `SpaceProvider`.
- One reproduced defect: a join that starts as one account can finish after an account switch and overwrite the next account’s space. It failed before the repair and passes after.
- Full Aoi suites: 2,575 unit tests and 612 integration tests passed.
- The report keeps the previously verified defect visible even when a small live run does not regenerate that scenario.
- A live run replaces the active scenario set. Run `pnpm mirofish -- --demo` to restore the full 19-scenario demo.

## Safety

- No production database, real customer data, tokens, recovery phrases, or decrypted media.
- Seeds and personas are fictional.
- The OpenCode Go proxy binds to loopback.
- MiroFish is AGPL-3.0; it is a separate checkout, never vendored.
- A missing key or server is a blocked result, never a fabricated success.

## Going deeper

- `ALTERNATIVES.md` — Zep alternatives and free options.
- `oasis/README.md` — local OASIS details.
- `reports/latest.md` — the latest evidence-backed report.
- `seeds/` — the curated source material.
- `scenarios/` — the generated specifications.
