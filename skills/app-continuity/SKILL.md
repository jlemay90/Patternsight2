---
name: app-continuity
description: Continue an existing application across coding agents while preserving its purpose, recoverable versions, test evidence, and a portable handoff.
---

# App continuity

This is a project-bundled portable skill, authored in this session from the
user's shared protocol. It is not a verified copy of their separately created
skill and is not automatically installed in other assistants.

## Receive
0. Prefer the canonical GitHub repository when configured. Read REPOSITORY.md,
   inspect remotes, fetch current branches/tags, and verify the intended source
   revision before continuing. Record unavailable or failed remote access.
1. Read AGENTS.md and the permanent project documents. Inspect source and Git.
2. State the user goal, current behavior, non-negotiable contracts, last tested
   revision, actual HEAD/branch/dirty state, and discrepancies you discover.
3. Preserve user changes. Establish a recoverable baseline before edits. Do not
   fabricate an original version or call an untested revision stable.
4. Run available baseline checks. Separate failed, blocked, and untested checks.
5. Select a concrete next task consistent with the user's authorization. Continue
   routine work autonomously; ask only for genuinely missing decisions.

## Work
Use a separate branch for substantial changes. Preserve working behavior and
the original vision. Explain major redesigns before implementation. Keep secrets
and personal data out of source, logs, fixtures, and exports. Read environment
instructions before installing tools. Do not rewrite merely for preference.
Track prompt/schema versions and synthetic regression cases for AI behavior.
Do not merge experimental branches into stable main without user approval.

## Verify and hand off
Commit and push the work branch when authorized and access permits. Verify that
the remote points to the exact local commit. Include repository, branch and commit
URLs in the handoff. Public read access does not imply write permission. Never
claim an uncreated repository exists or local changes are remotely published.
Run checks appropriate to changed behavior. Report commands and actual results,
including provider calls that were not made. Update PROJECT-OVERVIEW.md,
ARCHITECTURE.md, CHANGELOG.md, DECISIONS.md, KNOWN-ISSUES.md, TEST-REPORT.md,
and AGENT-HANDOFF.md where relevant. Keep exact handoff fields for source commit,
branch, stable reference, working-tree state, completed work, blockers, next task,
and acceptance criteria. A documentation-only commit may follow the tested source
commit: record both through Git rather than claiming a self-referential hash.

ORIGINAL is the earliest available recoverable baseline. PREVIOUS is the last
tested stable application, if one exists. CURRENT is HEAD plus disclosed working
changes. Use commits/tags; do not maintain three competing app directories.

Export complete tracked source, dependency manifests, setup instructions, env
variable names, prompt/schema files, synthetic fixtures and docs. Include Git
history via a bundle when available. Exclude secrets and personal data. Verify
the receiving package can be extracted and its checks run. Never claim a remote
repository or universal skill is synchronized/installed without verification.
