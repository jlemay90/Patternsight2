# Test report — v0.2.0 (branch `agent/04-aistudio-build`)

Imported baseline: `https://github.com/jlemay90/patternsight` (`origin/main` at `ee510829b0f176a4696cf019151491f9cc138345`, `stable/foundation-v0.1.0` at `64863bb`, foundation code `b1fdcaaab5b37541632f633abc1300f0c8ce452a`).

## Executed and Passed in AI Studio Build Environment

- **Baseline verification before edits**:
  - Cloned `https://github.com/jlemay90/patternsight`, verified `origin/main` == `ee510829b0f176a4696cf019151491f9cc138345`, ran all 11 original tests in `tests/test_app.py`, `node --check static/app.js`, and `python3 scripts/check_handoff.py` (all passed).
- **Live Server-Side Gemini Verification on Port 3000 (`/api/analyze` & `/api/chat`)**:
  - Verified live server-side Gemini requests via `@google/genai` on `http://127.0.0.1:3000`:
    - `POST /api/analyze` on the `positive-and-counterexample` synthetic fixture returned `HTTP 200` with verified verbatim quotes, cautious hypothesis framing, and explicit counterexample preservation (`"Walking is associated with a calmer state on Monday and Tuesday, but failed to alleviate frustration on Wednesday following a conflict"`).
    - `POST /api/chat` with an unrecorded topic (`"What does my journal say about learning Mandarin?"`) returned `HTTP 200` with `evidence: []`, `has_evidence: false`, and `"Your provided journal entries do not mention learning Mandarin..."`.
    - Temporary test entries were deleted immediately afterward so the personal SQLite database starts clean (`0` entries).
- **TypeScript Full-Stack & Evidence Contract Suite (`npx tsx tests/test_server_ts.ts`)**:
  - Passed. Verifies exact-quote substring acceptance, fabricated-quote rejection, unknown-ID rejection, sparse 0-insight allowance, local deterministic insight & counterexample generation, local grounded chat "no evidence" response, cross-origin rejection (`403`), entry creation (`/api/entries`), entry editing (`/api/edit`), consent enforcement (`400`), mocked Gemini analysis (`/api/analyze`), feedback persistence and propagation to chat (`/api/feedback` -> `/api/chat`), and derivative clearing on deletion (`/api/delete`).
- **Python API, Storage & Contract Suite (`python3 -m unittest discover -s tests -v`)**:
  - Passed (13 tests, including all 11 original tests plus `test_edit_entry_updates_text_and_clears_stale_derivatives` and `test_local_deterministic_insights_and_no_evidence_chat`).
- **Static JS & Continuity Checks**:
  - `node --check static/app.js`: passed.
  - `python3 scripts/check_handoff.py`: passed (15 required continuity files present; no private `.env` or `data/` files tracked).
- **TypeScript Typecheck & Vite Production Build**:
  - `npm run lint` (`tsc --noEmit`): passed with 0 errors.
  - `npm run build` (`vite build`): passed.

## Not Verified / Environment Limits

- **Playwright Chromium smoke scripts (`tests/browser_smoke.py`, `tests/browser_ai_smoke.py`)**: Python `playwright` and `/usr/bin/chromium` are not pre-installed in this container image.
