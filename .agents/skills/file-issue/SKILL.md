---
name: file-issue
description: >
  Draft a GitHub issue, get explicit user approval, and file it via the `gh` CLI.
  TRIGGER when: user wants to file or "drop" a GitHub issue / ticket.
argument-hint: "[what the issue is about]"
---

# File an Issue

Draft a GitHub issue and file it after the user approves. For the content shape — the issue types (epic, feature, task, bug, research task), style, and the per-type templates — follow [docs/guidelines/issue-guidelines.md](../../../docs/guidelines/issue-guidelines.md). This skill layers the workflow (understand → decide type → research → dedupe → draft → approve → file) on top of those guidelines.

## Workflow

1. **Understand the request thoroughly.** Read the user's prompt carefully — multiple times if it's long or ambiguous. Identify what problem they're describing, who it affects, and what outcome they want. Restate it back in one or two sentences to confirm shared understanding. Ask follow-ups for anything that would change the shape of the issue (scope, who it affects, dependencies on other work). Do not start drafting until you genuinely understand the ask.

   Because **Context leads every template** — why this matters, what led here — make sure you actually have it. If the user's ask doesn't convey that context, ask them for it before drafting. A ticket without real context is the main thing this step exists to prevent.

   Then let the user decide the type: every issue is an **epic**, **feature**, **task**, **bug**, or **research task** (see the guidelines doc). State which type you read the ask as and why, and let the user confirm or override — the type picks the template and how the issue is filed. Skip the question only when the type is unmistakable.

2. **Research the codebase thoroughly.** Do real investigation of the current state — read relevant files, trace how the feature works today, understand the user-visible behavior end-to-end. The goal is to describe the status quo *accurately*, not superficially. A shallow understanding produces a vague ticket.

   **But keep the research out of the issue itself.** Do not pull file paths, function names, line numbers, data structures, or architectural detail into the draft. The research informs your writing; it does not appear in it. If a sentence only makes sense to someone who's read the code, rewrite it.

3. **Check for duplicates.** Before drafting (or at latest, before filing), search existing issues on the target repo:

   ```sh
   gh issue list --repo owner/repo --search "keywords" --state all
   ```

   Use multiple keyword variations drawn from the user's request. If you find a plausible duplicate or closely-related issue, surface it to the user with a one-line summary and ask how to proceed — options include: add a comment to the existing issue, file a new one anyway with a cross-link, or close the request as already-tracked. Do not silently file a duplicate.

4. **For any non-epic type: consider an epic.** Fetch the epics from the project board and check whether one clearly fits:

   ```sh
   gh project item-list 1 --owner dam-agents --limit 3000 --format json \
     | jq -r '.items[] | select(.status=="Epics") | "#\(.content.number)  \(.title)"'
   ```

   If one does, put it on the draft's **Epic** line with a one-line justification. If nothing fits, leave the line out — placement can be decided later in triage. Epics themselves have no parent; skip this step.

5. **Draft inline.** Produce the draft following [docs/guidelines/issue-guidelines.md](../../../docs/guidelines/issue-guidelines.md), using the decided type's template. Present the full draft (title + body, plus the Epic line if one was suggested) in the chat. Do not file yet.

6. **Get explicit approval.** Ask whether to file as-is or revise. NEVER file without explicit approval. Approval covers the type and any epic suggestion too — if the user changes either, that's a revision.

   **Every revision invalidates the previous approval.** If the user requests any change after approving — even a small one — you must present the revised draft and get a fresh, explicit "file it" before sending to GitHub. Do not assume the original approval carries over.

7. **File via `gh` CLI.** Use `gh issue create`. Infer the repo from context (current working directory's git remote, or a repo mentioned earlier in the session). If unclear, ask. Then apply the relationships (below) and return the issue URL.

## Filing

After approval, file with `gh issue create`. Do not use the GitHub MCP tools (`mcp__github__*`) for this — always use `gh`.

- `--repo owner/repo` — infer from git remote or prior context; ask if ambiguous
- `--title "..."` — exactly as approved
- `--body "..."` — exactly as approved, minus the **Epic** line (it's draft metadata, applied as the parent relationship below, not body text); pass via a HEREDOC so markdown formatting survives
- `--label foo --label bar` — only if the user specified labels

Example:

```sh
gh issue create --repo owner/repo --title "Short declarative title" --body "$(cat <<'EOF'
## Problem

...

## Proposed solution

...
EOF
)"
```

### After filing: attach to the epic, if one was approved

If the approved draft carries an **Epic** line, set that epic as the issue's parent via the sub-issues API. It takes the child's numeric database `id` (not the issue number, not the node ID):

```sh
CHILD_ID="$(gh api repos/owner/repo/issues/<issue-number> --jq .id)"
gh api repos/owner/repo/issues/<epic-number>/sub_issues -F sub_issue_id="$CHILD_ID"
```

If there's no Epic line, skip this.

### After filing an epic

Add the issue to the project board and tell the user it still needs its board Status set to `Epics` and a Focus (Now / Next / Later) — those are set on the board, usually by the Product Owner:

```sh
gh project item-add 1 --owner dam-agents --url <issue-url>
```

Return the resulting issue URL to the user in one line (mention the epic it was attached to, if any). Do not add commentary about what was filed — the draft already conveyed that.
