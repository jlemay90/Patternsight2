# Known issues and limits

1. **Live Gemini unverified in container** — `GEMINI_API_KEY` is not populated in the default automated test environment (`length: 0`). Server-side `@google/genai` SDK (`server.ts`) and REST (`engine.py`) integrations, structured schemas, and failure handling are implemented and tested with mocked provider responses. Live model latency and semantic quality require an active `GEMINI_API_KEY` configured in AI Studio **Settings > Secrets** or local `.env`.
2. **Local single user only** — no multi-user auth or encryption at rest.
3. **Bounded recent context** — up to 60 newest entries and 60,000 text characters, plus up to 30 saved corrections. Questions about older entries outside the 60-entry / 60,000-character window are not in scope unless filtered.
4. **Not clinical monitoring** — sparse and selectively written journals cannot establish causes, diagnoses, or clinically reliable anomaly detection. Exact quote validation verifies quote provenance, not the clinical truth of an interpretation.
5. **Exports and deletion** — source export excludes personal data; journal JSON export includes it. Deleting or editing an entry invalidates stored derived records in SQLite, but does not overwrite raw SQLite free pages or external backups.
6. **Claude source missing** — public `jlemay90/patternsight` hosts the verified foundation (`ee51082`), while Claude's referenced `agent/02-live-eval-prep` (`b346504` / `e0a0315`) was never pushed to GitHub or supplied as a bundle. No claim of importing Claude's missing branch is made.
