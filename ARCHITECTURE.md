# Architecture — v0.2.0 (AI Studio Build + Standalone Python Parity)

## Runtime Components

- `server.ts` + `src/server/app.ts`: Express server running on port `3000` (`0.0.0.0`) for AI Studio Build preview and production deployment. Mounts Vite middleware in development and serves `dist/` in production. No secondary proxy or duplicate server process is spawned.
- `src/server/store.ts`: Node `node:sqlite` (`DatabaseSync`) storage module using `data/patternsight.sqlite3` with schema version 1 (`entries`, `analyses`, `feedback`). Fully compatible with `server.py`.
- `src/server/engine.ts`: Server-side `@google/genai` integration (`GoogleGenAI` with `User-Agent: aistudio-build` and `gemini-3.8-flash` default), deterministic `validateResult` / `validateEvidence` exact-substring verifier, and offline deterministic evidence/counterexample inspector (`generateLocalDeterministic`).
- `src/App.tsx` + `src/types.ts`: Responsive React + Tailwind CSS interface implementing journal creation/editing, dated entry history, search/filter, JSON import/export, evidence-cited insight cards with exact quote highlighting, counterexamples and uncertainty, user feedback/corrections, grounded chat with explicit no-evidence notices, and the continuity/fixture verification view.
- `server.py` + `engine.py` + `static/`: Preserved and upgraded Python standard-library + framework-free static UI implementation sharing the identical SQLite schema, prompt file, and HTTP contract.
- `prompts/reflect-v1.txt`: Versioned system instruction (`reflect-v1`).
- `fixtures/reflection-cases.json`: Synthetic qualitative test cases (`sparse`, `positive-and-counterexample`, `injection`, `correction`, `missingness`).
- `tests/`: `tests/test_server_ts.ts` (TypeScript Express/SQLite/contract test suite) and `tests/test_app.py` (Python unittest API/storage/contract suite).

## Data Flow & Privacy Invariants

1. **Local by Default**: Journal entries are written to local SQLite (`data/patternsight.sqlite3`).
2. **Invalidation on Delete or Text Edit**: Deleting an entry (`/api/delete`) or modifying an entry's text (`/api/edit`) clears stored `analyses` and `feedback` inside the same database transaction so derived text can never quote deleted or outdated source passages.
3. **Explicit Consent for External AI**: `/api/analyze` and `/api/chat` require `{ consent: true }` and send at most the 60 newest entries (capped at 60,000 text characters) plus up to 30 saved corrections to Google Gemini on the server.
4. **Deterministic Quote Provenance**: Every model or local insight output must pass `validateResult`, which verifies that `0 <= insights.length <= 3`, every `entry_id` exists in the bounded context, and every `quote` is a non-empty exact substring of that entry's text. Invalid responses are rejected without overwriting existing saved analyses.
5. **Server-Only Secrets**: `GEMINI_API_KEY` is read exclusively on the server (`process.env.GEMINI_API_KEY`). No API key input fields or secret values are ever rendered in the browser.

## HTTP Contract

- `GET /api/state`, `GET /api/export`, `GET /api/continuity`, `GET /api/fixtures`
- `POST /api/entries` `{ text, mood: null|1..5, tags: string[], created_at?: string }`
- `POST /api/edit` `{ id, text, mood: null|1..5, tags: string[], created_at?: string }`
- `POST /api/delete` `{ id }`
- `POST /api/import` `{ entries: [...] }`
- `POST /api/feedback` `{ insight_id, rating: 'fits'|'partly'|'doesnt-fit', note }`
- `POST /api/analyze` `{ consent: true, entry_ids?: string[] }`
- `POST /api/chat` `{ consent: true, question, entry_ids?: string[] }`
- `POST /api/local-analyze` `{ entry_ids?: string[] }`
- `POST /api/local-chat` `{ question, entry_ids?: string[] }`
