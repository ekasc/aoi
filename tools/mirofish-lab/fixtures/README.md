# Fixtures

Both files here are **offline development fixtures**, not MiroFish runs.

- `simulation-bundle.dryrun.json` — 19 hand-authored synthetic discussion observations used to exercise extraction, validation, coverage, and execution without a live server. It says `mode: dry_run_fixture`, `live: false`, and labels itself as not a MiroFish run.
- `baseline-contract.dryrun.json` — six contract-only questions, one per experiment group, used as the simple comparison baseline.

No production memories, private messages, credentials, recovery phrases, decrypted media, or real locations are present. Do not relabel either file as live output. A real bundle is produced by `pnpm mirofish-lab:run -- --mode live` and stored under the gitignored `runs/` directory.
