# Changelog

## 0.2.0 — 2026-11-11 — AI Studio Build full-stack implementation & feature completion (agent 04)

- Imported canonical GitHub repository `https://github.com/jlemay90/patternsight` (`origin/main` at `ee510829b0f176a4696cf019151491f9cc138345`, preserving `original` tag `9762397` and `stable/foundation-v0.1.0` tag `64863bb`) onto work branch `agent/04-aistudio-build`.
- Built unified AI Studio Build full-stack runtime (`server.ts`, `src/server/app.ts`, `src/server/store.ts`, `src/server/engine.ts`) on port `3000` using `node:sqlite` and `@google/genai` (`>=3.2.0`, server-side only with `User-Agent: aistudio-build` and `gemini-3.8-flash` default) while preserving full compatibility with standalone `server.py`, `engine.py`, and `static/`.
- Added journal entry editing (`POST /api/edit`) with automatic invalidation of derived analyses/feedback when source text changes, plus JSON backup import (`POST /api/import`).
- Added live search and filtering by text/quote substring, self-reported mood range, tag, and date sort order in the UI.
- Added counterexample and uncertainty surfacing in insights, exact-quote click-to-highlight navigation back to source entries, and explicit no-evidence notices in grounded chat when the journal lacks supporting quotes.
- Added offline deterministic evidence and counterexample inspection (`POST /api/local-analyze` and `POST /api/local-chat`) verified by the exact same `validateResult` quote-provenance checks, while keeping `/api/analyze` and `/api/chat` strictly honest (`502 AI is not connected`) when `GEMINI_API_KEY` is unset.
- Added TypeScript integration and contract test suite (`tests/test_server_ts.ts`), expanded Python test suite (`tests/test_app.py` to 13 tests), and added `tests/__init__.py` for Python 3.10+ unittest discovery.

## Initial GitHub publication — 2026-11-10

- Connected public https://github.com/jlemay90/patternsight, published source history and original/stable tags, and prepared main as the tested initial baseline.
- Updated receiving prompts and repository status; no application code changed.

## GitHub handoff preparation — 2026-11-10

- Added REPOSITORY.md and GitHub-first receiving/publishing requirements.
- Recorded the blocked repository-creation operation and missing Claude source.
- Updated continuity instructions without changing application code or stable tags.

## 0.1.0 — 2026-11-10 — Foundation / agent 01

- Preserved initial requirements and multi-agent protocol as the original Git baseline; built on a separate branch.
- Added local persistent journal, optional mood ratings/tags, mood bars, deletion and private JSON export with responsive interface.
- Added server-side Gemini integration, versioned system instruction, structured schemas, exact evidence checks, up to three hypotheses and correction feedback.
- Added entry-grounded question UI and visible provider setup/failure states.
- Added project continuity panel, copyable receiving prompt, portable skill, permanent project documents and source/Git export tooling.
- Added API, storage, contract and browser verification using synthetic text.
- Live Google calls remain untested; no secrets or personal journals exported.
