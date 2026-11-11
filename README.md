# PatternSight

An evidence-grounded reflective journal that helps its owner notice recurring situations in their own entries, inspect the exact verbatim evidence, weigh counterexamples and uncertainty, and test what helps.

Canonical repository: `https://github.com/jlemay90/patternsight`

## Run in AI Studio Build (Full-Stack TypeScript + React + SQLite on Port 3000)

```sh
npm run dev
```

In AI Studio Build preview, `server.ts` serves both the `/api/*` JSON routes and the Vite/React frontend on port `3000` (using `node:sqlite` backed by `data/patternsight.sqlite3`).

Production build & start:

```sh
npm run build
npm start
```

## Run Standalone Python Server (Zero-Dependency Local CLI on Port 8000)

```sh
python3 server.py
```

Opens at `http://127.0.0.1:8000` using the same `data/patternsight.sqlite3` database schema, `prompts/reflect-v1.txt` system instruction, and `/api/*` contract.

## Connect Server-Side Gemini

- **AI Studio Build**: Configure `GEMINI_API_KEY` in the **Settings > Secrets** panel.
- **Local `.env`**: Copy `.env.example` to `.env`, set `GEMINI_API_KEY` and optional `GEMINI_MODEL` (default `gemini-3.8-flash`), and restart the server.
- Never put an API key in client code, chat, or Git.
- When `GEMINI_API_KEY` is absent, `/api/analyze` and `/api/chat` return an explicit `502 AI is not connected` error and never fabricate Gemini results.
- You can also run **Inspect local evidence & counterexamples (Offline)** (`/api/local-analyze`) and **Search Local Evidence** (`/api/local-chat`) at any time without external API calls. Both use the exact same deterministic `validateResult` quote-provenance validator.

## Core Capabilities

- **Journal Creation & Editing**: Create and edit reflections (`1..10,000` chars) with optional self-reported mood (`1..5`), up to 8 context tags, and optional custom entry timestamps. Editing entry text automatically invalidates stored derived analyses so quotes never become stale.
- **Dated Entry History, Search & Filter**: Filter entries by text/quote substring, self-reported mood range, or tag, and sort newest or oldest first. Export or import JSON backups.
- **Evidence-Cited Reflection Insights**: Up to 3 hypotheses (`low` or `medium` evidence strength, or `0` insights when history is sparse), each citing verified verbatim substrings from your entries with one-click navigation that scrolls to and highlights the exact quote in your journal.
- **Counterexamples & Uncertainty**: Every hypothesis surfaces counterexamples, alternative explanations, a reflection question, and a small optional experiment.
- **User Corrections & Feedback**: Mark insights as `Fits`, `Partly fits`, or `Doesn’t fit` with an optional correction note (`POST /api/feedback`). Up to 30 saved corrections accompany subsequent analysis and chat requests.
- **Grounded Chat & No-Evidence Safeguard**: Ask questions about your entries. Answers cite exact entry quotes and explicitly state when the journal has no supporting evidence for a topic.

## Verification

```sh
npx tsx tests/test_server_ts.ts
python3 -m unittest discover -s tests -v
node --check static/app.js
python3 scripts/check_handoff.py
npm run lint
npm run build
```
