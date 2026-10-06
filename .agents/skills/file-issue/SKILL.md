---
name: file-issue
description: >
  Draft a GitHub issue, get explicit user approval, and file it via the `gh` CLI.
  TRIGGER when: user wants to file or "drop" a GitHub issue / ticket.
argument-hint: "[what the issue is about]"
---

# File an Issue

Content shape: all of [docs/guidelines/issue-guidelines.md](../../../docs/guidelines/issue-guidelines.md).

## Workflow

1. **Understand the request.** Identify the problem, who it affects, and the outcome wanted. Restate it in one or two sentences, and ask follow-ups for anything that would change the issue's shape (scope, who it affects, dependencies) before drafting. **Context leads every template** (why this matters, what led here): if the ask doesn't convey it, ask for it.

   **Came from user feedback in Slack?** Get the permalink to the thread where it was raised (ask if you don't have it) — it goes in the **Follow up** section at the end of the body (see **Follow up** in the guidelines). If it was raised in a DM, also note which team member was in it.

   Then let the user decide the type: epic, feature, task, bug, or research task (see the guidelines). Say which you read the ask as and why; the user confirms or overrides, and the type picks the template and how the issue is filed. Skip the question only when the type is unmistakable.

2. **Research the codebase.** Trace how the feature works today and its user-visible behavior end-to-end, so the issue describes the status quo accurately. **Keep the research out of the issue**: no file paths, function names, line numbers, data structures or architectural detail. A sentence that only makes sense to someone who has read the code gets rewritten.

3. **Check for duplicates** before drafting, or at the latest before filing, with several keyword variations from the request:

   ```sh
   gh issue list --repo owner/repo --search "keywords" --state all
   ```

   On a plausible duplicate or close relative, show it with a one-line summary and ask: comment on it, file anyway with a cross-link, or drop the request as already tracked.

4. **Non-epic types: consider an epic.** List the board's epics:

   ```sh
   gh project item-list 1 --owner dam-agents --limit 3000 --format json \
     | jq -r '.items[] | select(.status=="Epics") | "#\(.content.number)  \(.title)"'
   ```

   If one clearly fits, put it on the draft's **Epic** line with a one-line justification. Otherwise omit the line; triage can place it later. Epics have no parent.

5. **Draft inline** with the type's template: full title + body (+ Epic line) in the chat.

6. **Filed by footer?** You file under a credential you don't own; compare its owner with the requester (rule, format and fallback order: **Attribution** in the guidelines).

   ```sh
   gh api user --jq .login                                         # the account you file as
   gh api "search/users?q=<name-or-email>" --jq '.items[].login'   # the requester
   ```

   Same person: no footer, GitHub credits them. Different: append the footer to the body presented in step 5, so the approved body carries it. Never credit the filing account instead of the requester.

7. **Get explicit approval** to file as-is or revise. Never file without it. Approval covers the type and epic too; changing either is a revision. **Every revision voids the previous approval**: present the revised draft and get a fresh, explicit "file it".

8. **File** (below) and apply the relationships.

## Filing

Use `gh issue create`, never the GitHub MCP tools (`mcp__github__*`):

- `--repo owner/repo`: from the git remote or earlier context; ask if ambiguous
- `--title`: exactly as approved
- `--body`: exactly as approved, Filed by footer included, **Epic** line removed (it's draft metadata, applied as the parent below); pass via HEREDOC so markdown survives
- `--label`: only labels the user specified

```sh
gh issue create --repo owner/repo --title "Short declarative title" --body "$(cat <<'EOF'
## Problem

...

## Proposed solution

...

---

_Filed by @requester-handle_
EOF
)"
```

### Approved Epic line → attach as parent

The sub-issues API takes the child's numeric database `id` (not the issue number, not the node ID):

```sh
CHILD_ID="$(gh api repos/owner/repo/issues/<issue-number> --jq .id)"
gh api repos/owner/repo/issues/<epic-number>/sub_issues -F sub_issue_id="$CHILD_ID"
```

### Filed an epic → add to the board

```sh
gh project item-add 1 --owner dam-agents --url <issue-url>
```

Tell the user it still needs board Status `Epics` and a Focus (Now / Next / Later), usually set by the Product Owner.

Return the issue URL in one line (plus the epic it was attached to, if any), with no commentary on what was filed.
