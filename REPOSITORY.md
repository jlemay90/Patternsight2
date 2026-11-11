# Shared repository and synchronization

Canonical public repository: https://github.com/jlemay90/patternsight
Clone URL: https://github.com/jlemay90/patternsight.git
Integration branch / default branch: `main`.
Status: owner created the empty public repository; source branches and original /
stable tags were published on 2026-11-10. The tested foundation is the initial
public main baseline; later experimental changes must use separate branches.

## Initial publication

The remote was verified empty before any push. Origin points to the clone URL
above. Branches agent/01-foundation and agent/03-github-handoff preserve session
work; tags original and stable/foundation-v0.1.0 preserve the historical baselines.
Initial main publication fast-forwards the existing docs-only baseline to the
verified foundation and continuity documents; no history is rewritten.
Repository creation and default-branch setting were denied by integration
permissions, but publishing Git refs succeeded. The owner created the repo and
its existing default is main. Resolve latest exact commit through Git; verify
remote IDs rather than relying on a handoff's branch label alone.

## Every incoming agent

1. Clone the canonical repository or inspect `git remote -v` in an existing copy.
2. Run `git fetch origin --prune --tags`, inspect default/current remote branches,
   and read their AGENTS.md and AGENT-HANDOFF.md. A fetch failure is a blocker to
   claiming current remote state; a ZIP alone may be stale.
3. Record repository URL, source branch, exact commit, baseline test results and
   local dirty state. Start a new work branch from the intended latest source.
4. Preserve work on other branches. No force pushes, silent resets, or experimental
   merge into stable main without owner approval.

## Every outgoing agent

Commit code and updated permanent docs, push the work branch, verify that the
remote branch points to the same exact commit, and give the owner a repository
URL, branch URL, commit URL, checks and next task. If authorized, open a PR for
review. Public visibility enables reading; pushing still requires account access.
Do not claim synchronization when a push or verification failed. Keep the ZIP
and Git bundle as offline fallback. Exclude .env, journals, databases and private
exports from both source control and history.

## Claude continuity gap

User supplied a Claude handoff claiming branch `agent/02-live-eval-prep`, docs
HEAD `b346504`, tested source `e0a0315`, `scripts/eval_reflection.py`, and eight
synthetic fixtures. No source archive or bundle for those changes has been
received; neither commit nor that evaluator exists in this checkout. Claude did
not use GitHub according to the owner. These are unverified handoff claims,
not source that can be recreated from the message. Preserve and import Claude's
actual source/Git bundle when supplied, then compare ancestry and changes before
continuing its live evaluation. Do not label the agent-01 foundation as agent 02.
