---
name: file-issue
description: >
  Draft a GitHub issue, get explicit user approval, and file it via the `gh` CLI.
  TRIGGER when: user wants to file or "drop" a GitHub issue / ticket.
argument-hint: "[what the issue is about]"
---

# File an Issue

Draft a GitHub issue and file it after the user approves. For the content shape — what belongs in an issue, what doesn't, and the template — follow [docs/guidelines/issue-guidelines.md](../../../docs/guidelines/issue-guidelines.md). This skill layers the workflow (understand → research → dedupe → draft → approve → file) on top of those guidelines.

## Workflow

1. **Understand the request thoroughly.** Read the user's prompt carefully — multiple times if it's long or ambiguous. Identify what problem they're describing, who it affects, and what outcome they want. Restate it back in one or two sentences to confirm shared understanding. Ask follow-ups for anything that would change the shape of the issue (scope, who it affects, dependencies on other work). Do not start drafting until you genuinely understand the ask.

2. **Research the codebase thoroughly.** Do real investigation of the current state — read relevant files, trace how the feature works today, understand the user-visible behavior end-to-end. The goal is to describe the status quo *accurately*, not superficially. A shallow understanding produces a vague ticket.

   **But keep the research out of the issue itself.** Do not pull file paths, function names, line numbers, data structures, or architectural detail into the draft. The research informs your writing; it does not appear in it. If a sentence only makes sense to someone who's read the code, rewrite it.

3. **Check for duplicates.** Before drafting (or at latest, before filing), search existing issues on the target repo:

   ```sh
   gh issue list --repo owner/repo --search "keywords" --state all
   ```

   Use multiple keyword variations drawn from the user's request. If you find a plausible duplicate or closely-related issue, surface it to the user with a one-line summary and ask how to proceed — options include: add a comment to the existing issue, file a new one anyway with a cross-link, or close the request as already-tracked. Do not silently file a duplicate.

4. **Draft inline.** Produce the draft following [docs/guidelines/issue-guidelines.md](../../../docs/guidelines/issue-guidelines.md). Present the full draft (title + body) in the chat. Do not file yet.

5. **Get explicit approval.** Ask whether to file as-is or revise. NEVER file without explicit approval.

   **Every revision invalidates the previous approval.** If the user requests any change after approving — even a small one — you must present the revised draft and get a fresh, explicit "file it" before sending to GitHub. Do not assume the original approval carries over.

6. **File via `gh` CLI.** Use `gh issue create`. Infer the repo from context (current working directory's git remote, or a repo mentioned earlier in the session). If unclear, ask. Return the issue URL.

## Filing

After approval, file with `gh issue create`. Do not use the GitHub MCP tools (`mcp__github__*`) for this — always use `gh`.

- `--repo owner/repo` — infer from git remote or prior context; ask if ambiguous
- `--title "..."` — exactly as approved
- `--body "..."` — exactly as approved; pass via a HEREDOC so markdown formatting survives
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

Return the resulting issue URL to the user in one line. Do not add commentary about what was filed — the draft already conveyed that.
