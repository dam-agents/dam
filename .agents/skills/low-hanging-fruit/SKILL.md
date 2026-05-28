---
name: low-hanging-fruit
description: >
  Scan open GitHub issues, identify at most 3 that are simple to implement,
  then fix them in parallel — each on its own branch with a separate PR.
  Presents selections and diffs for user approval.
allowed-tools:
  - Bash
  - Read
  - Edit
  - Write
  - Agent
  - AskUserQuestion
---

# Low-Hanging Fruit

Pick up to 3 easy wins from the issue tracker, fix them in parallel, and open PRs.

## Phase 1 — Scan issues

Fetch all open issues:

```sh
gh issue list --state open --json number,title,body,labels,url --limit 100
```

## Phase 2 — Identify candidates

Read each issue's title and body. Score for simplicity using these signals:

- **Labels**: `good first issue`, `easy`, `minor`, `chore`, `docs` → simpler.
- **Scope**: single-file or single-package changes, typos, config tweaks, small refactors.
- **Clarity**: the issue describes the fix explicitly or the path is obvious from the title.
- **Anti-signals**: issues mentioning architecture changes, multi-package coordination, new features requiring design, or open questions → skip.

Select **at most 3** issues. Fewer is fine if the backlog doesn't have easy wins.

## Phase 3 — Present candidates

Present the candidates to the user as a numbered list:

| # | Issue | Title | Why it's simple |
|---|-------|-------|-----------------|

Include a one-sentence rationale for each. Ask the user to confirm which ones to work on (default: all listed).

## Phase 4 — Fix in parallel

After approval, work on all confirmed issues **in parallel using Agent subagents in worktree isolation**. For each issue, spawn an Agent with `isolation: "worktree"`:

Each agent must:

1. Read the full issue body (`gh issue view <number> --json body`).
2. Investigate the relevant code.
3. Implement the fix.
4. Run `mise run check` to verify.
5. Commit with `git commit -s` using conventional commit format and a message referencing the issue (`Closes #<number>`).

**Important**: pass each agent enough context to work independently — the issue number, title, body summary, and which files are likely involved.

## Phase 5 — Review and approve

After all agents complete, for each worktree that has changes:

1. Show the diff (`git diff main...HEAD` from the worktree).
2. Summarize what changed and why.
3. Ask the user for explicit approval before pushing and opening a PR.

On approval, push the branch and create a PR:

```sh
gh pr create --title "<type>(scope): <summary>" --body "$(cat <<'EOF'
## Summary

<what and why>

Closes #<issue-number>

## Test plan

- [ ] `mise run check` passes
- [ ] `mise run test` passes
EOF
)"
```

On rejection, ask what to change or skip the item.

## Phase 6 — Summary

Print a final summary:

| # | Issue | Title | Status | PR |
|---|-------|-------|--------|----|

Status: PR opened, skipped, user declined.

## Rules

- Never commit or push without explicit user approval for that specific item.
- Each fix gets its own branch and PR — never bundle issues together.
- Always run `mise run check` before presenting a diff.
- Follow the project's commit conventions (conventional commits, signed-off, no manual attribution trailer).
- Branch naming: `fix/<slug>` or `chore/<slug>` depending on the issue type.
- If an issue turns out to be more complex than expected during implementation, report back instead of forcing a bad fix.
- Maximum 3 issues per run — quality over quantity.
