# PatternSight

An evidence-grounded reflective journal that helps its owner notice recurring situations, inspect the exact evidence, weigh counterexamples and uncertainty, and test what helps.

Canonical repository: `https://github.com/jlemay90/patternsight`

## Non-Negotiable Product Contracts

- **Self-reported mood vs. inferred tone**: Mood ratings (`1..5`) are self-reported by the author. Writing tone is never presented as a measured mood velocity.
- **Exact quote provenance**: Every insight hypothesis and grounded chat citation must reference a valid `entry_id` and an exact verbatim substring of that entry's text, verified deterministically on the server before storage or display.
- **Zero to three hypotheses**: Returning zero insights when evidence is sparse is an expected, valid outcome—no quota filling.
- **Counterexamples & uncertainty**: Helpful patterns and stressors are both examined alongside counterexamples, alternative explanations, a reflection question, and a small optional experiment. Never diagnose, assign clinical labels, or infer withdrawal from missing days.
- **User corrections persist**: Owner ratings (`Fits`, `Partly fits`, `Doesn't fit`) and correction notes persist in SQLite and are supplied as context to subsequent analysis and chat requests.
- **Grounded chat & no-evidence honesty**: Reflection Partner answers questions using bounded journal entries and explicitly states when the journal contains no supporting evidence for a question.
- **Local-first & server-side secrets**: Data stays in local SQLite (`data/patternsight.sqlite3`) until the owner explicitly consents to send bounded context to Gemini. `GEMINI_API_KEY` stays strictly on the server; no fake Gemini responses are returned when a key is absent.
