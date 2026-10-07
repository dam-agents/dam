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

## 1. Pick candidates

```sh
gh issue list --state open --json number,title,body,labels,url --limit 100
```

Score each issue for simplicity:

- **Labels** `good first issue`, `easy`, `minor`, `chore`, `docs` → simpler.
- **Scope**: single file or package, typos, config tweaks, small refactors.
- **Clarity**: the issue states the fix, or the title makes it obvious.
- **Skip**: architecture changes, multi-package coordination, features needing design, open questions.

Select **at most 3**; fewer if the backlog has no easy wins. Present them, one-sentence rationale each, and ask which to work on (default: all):

| # | Issue | Title | Why it's simple |
|---|-------|-------|-----------------|

## 2. Fix in parallel

Spawn one Agent per confirmed issue with `isolation: "worktree"`, giving each enough context to work alone: number, title, body summary, likely files. Each agent:

1. Reads the full issue (`gh issue view <number> --json body`) and the relevant code.
2. Implements the fix on branch `fix/<slug>` or `chore/<slug>` (by issue type).
3. Runs `mise run check`.
4. Commits with `git commit -s`, conventional format, `Closes #<number>` in the message, no manual attribution trailer.
5. Reports back instead of forcing a bad fix if the issue proves harder than it looked.

## 3. Review, then push

For each worktree with changes: show `git diff main...HEAD`, summarize what changed and why, and get explicit approval for that item. Only then push and open its PR:

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

On rejection, ask what to change, or skip the item.

## 4. Summary

| # | Issue | Title | Status | PR |
|---|-------|-------|--------|----|

Status: PR opened, skipped, or user declined.

## Rules

- Never push or open a PR without explicit user approval for that specific item.
