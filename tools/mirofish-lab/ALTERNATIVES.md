# Zep alternatives for the MiroFish lab

MiroFish is wired to **Zep Cloud**, not to a generic graph interface. Its backend imports `zep_cloud.client.Zep` and uses Zep-specific graph, batch, and chat surfaces across about 4,000 lines in seven files (`graph_builder.py`, `zep_entity_reader.py`, `zep_graph_memory_updater.py`, `zep_tools.py`, and the `zep_*` utilities). There is no supported config switch to another backend.

That matters when choosing a “free alternative”: only the first option is a drop-in.

## 1. Zep Cloud free plan — easiest, no code change

Zep’s current free plan gives **10,000 credits/month, 2 projects, no rollover**, and no card. Credits are consumed by ingestion: 1 credit per 350 bytes of an Episode.

The lab’s eight curated seed documents are small, and MiroFish’s graph-memory updates are disabled during a run, so one small simulation should fit. Start with `--rounds 4 --repeat 1` and `MIROFISH_INTERVIEW_AGENTS=4`.

- Cost: $0 for a small run.
- Open source: no.
- Effort: none beyond `ZEP_API_KEY`.
- Data: synthetic seeds only; no Aoi production data.

This is the recommended first live attempt.

## 2. OASIS directly — free and local, but not MiroFish

OASIS is the actual social-simulation engine MiroFish uses. It is **Apache 2.0**, runs locally, and stores posts/comments in SQLite. Zep is MiroFish’s graph/memory/report layer, not the interaction engine.

This mode is implemented at `oasis/` and `src/oasis.mjs`. It:

1. creates two OASIS agents per fictional couple,
2. runs a few Reddit-style rounds through MiroFish's upstream OASIS script,
3. emits the same normalized observation bundle, labelled `local_oasis`,
4. reuses the existing extractor, coverage analyzer, and Aoi tests.

What is lost: MiroFish’s Zep graph, entity extraction, profile generation from a graph, Report Agent, and interviews. What is gained: no Zep account, no cloud graph, no per-run credits.

This is more work than the dry-run but less work than replacing Zep inside MiroFish. It is the best fully free route if the social discussion itself is the useful part.

## 3. Graphiti + Neo4j Community — free software, real adapter work

Graphiti is Zep’s open-source temporal graph engine (**Apache 2.0**). It supports Neo4j, FalkorDB, and Neptune. Neo4j Community is free (GPLv3).

Graphiti is the closest conceptual replacement for Zep, but it is **not a drop-in**:

- MiroFish calls Zep Cloud methods directly.
- Graphiti has a different API, ontology model, episode ingestion, and retrieval surface.
- You would need an adapter or a fork, plus a graph database, embeddings, and tests.

The former Zep Community Edition is deprecated and unsupported (April 2025). Do not build on it.

Use this only if a third-party graph service is unacceptable and you are willing to own the adapter.

## 4. Other memory frameworks — not drop-in

These are credible open-source memory systems, but none replace Zep in MiroFish without the same kind of adapter work:

- **Mem0** — Apache 2.0 core, self-hostable; graph memory is not the free core path.
- **Letta** — Apache 2.0, agents that manage their own memory.
- **Cognee** — open-source graph/vector memory pipeline.
- **Hindsight** — MIT, self-hosted with embedded Postgres.
- **LangMem** — MIT, LangGraph-oriented.

They are alternatives to the *memory concept*, not to MiroFish’s specific Zep calls.

## Free LLM endpoints

Zep is only half the dependency. The model endpoint can also be free:

| Option | Endpoint style | Trade-off |
| --- | --- | --- |
| Ollama, local | OpenAI-compatible (`http://127.0.0.1:11434/v1`) | Free/private; small models are slow on 8 GB |
| Google AI Studio free tier | OpenAI-compatible endpoint | Free quota; rate limits and data-use terms |
| Groq free tier | OpenAI-compatible | Fast; strict rate limits |
| OpenRouter free models | OpenAI-compatible | `:free` models are rate-limited and may have data policies |
| Cloudflare Workers AI free allocation | OpenAI-compatible | Small free allocation; model limits |

MiroFish makes many calls (ontology, profiles, config, report, interviews). Free cloud tiers may throttle a full run; a local small model is slower but predictable.

## Recommendation

1. **Try Zep’s free plan + OpenCode Go** for one bounded live run. This is the only zero-code path and tests whether MiroFish adds value at all. OpenCode Go requires `x-opencode-session` and a client User-Agent; use `pnpm mirofish-lab:proxy`.
2. If Zep Cloud is unacceptable, run the **OASIS-only local mode** (`pnpm mirofish-lab:oasis`). It is implemented and keeps the social simulation while removing Zep. It still needs an LLM endpoint.
3. Do not port MiroFish to Graphiti unless you have evidence that the graph/report layer is the valuable part; the adapter is a project, not a configuration change.
