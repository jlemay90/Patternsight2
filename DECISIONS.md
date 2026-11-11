# Decisions

## 2026-11-11 — AI Studio Build full-stack parity & feature completion (agent 04)

- Imported canonical GitHub repository `https://github.com/jlemay90/patternsight` (`origin/main` at `ee51082`) and created work branch `agent/04-aistudio-build` without modifying `main` or baseline tags (`original`, `stable/foundation-v0.1.0`).
- Implemented unified Express + Vite + React + `node:sqlite` runtime (`server.ts`, `src/server/*`, `src/App.tsx`) on port `3000` for AI Studio Build preview while maintaining full SQLite schema and HTTP contract parity with `server.py`, `engine.py`, and `static/`.
- Avoided spawning duplicate servers or background proxy processes: `server.ts` directly reads and writes `data/patternsight.sqlite3` via built-in `node:sqlite`.
- Added entry editing (`/api/edit`) that invalidates stored analyses and feedback whenever entry text changes so stored quotes can never drift out of sync with edited entries.
- Added offline deterministic evidence & counterexample inspection (`/api/local-analyze`, `/api/local-chat`) clearly labeled as local deterministic mode so users can test exact-quote citations, counterexamples, user feedback, and no-evidence chat behavior even when `GEMINI_API_KEY` is unset, while keeping `/api/analyze` and `/api/chat` strictly honest (`502 AI is not connected`) when no key is configured.

## 2026-11-10 — Initial public repository publication

- Owner created jlemay90/patternsight and supplied its clone URL. Confirmed public access and an empty remote before publishing branches and baseline tags.
- Git push works; changing repository default-branch settings returned HTTP 403. Publish the tested foundation as the initial public main baseline via a fast-forward, preserving original history and tags.
- Keep agent session branches and GitHub-first handoff instructions. Claude's newer work remains a documented source-recovery gap, not a claimed import.

## 2026-11-10 — GitHub continuity preparation

- Owner requested a separate public patternsight repository.
- Make GitHub fetch/push plus exact remote revision verification part of every agent handoff. Archive/bundle is the offline fallback, not the preferred shared source after publication.
- Preserve Claude's supplied revision claims without inventing its unavailable source. REPOSITORY.md records the missing package and recovery requirements.

## 2026-11-10 — agent 01

- Chose HTML/CSS/JavaScript and Python stdlib + SQLite for immediate local use without package installation. React remains an option if future needs justify migration; do not rewrite by preference.
- Gemini called only server-side. Configurable model ID rather than hardwiring the outdated Gemini 1.5 request.
- Native mood ratings are the first trajectory. Deferred inferred sentiment velocity because it can imply precision unsupported by journal text.
- Zero to three hypotheses, exact quote links, alternative explanations, optional experiments, and saved correction context. No clinical anomaly labels.
- No seeded private-looking demo journal. Blank states are honest; synthetic fixtures stay outside the personal database.
