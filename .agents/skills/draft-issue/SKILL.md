---
name: draft-issue
description: >
  Template and writing guidelines for a GitHub issue. Every issue is one of epic, story, task, or bug — the user decides the type, and each type has its own template. Stories, tasks, and bugs can suggest a parent epic from the project board.
---

# Draft an Issue

Follow [docs/guidelines/issue-guidelines.md](../../../docs/guidelines/issue-guidelines.md) for the issue types, style, and the per-type templates.

## Workflow

1. **Understand the request thoroughly.** Read the user's prompt carefully — multiple times if it's long or ambiguous. Identify what problem they're describing, who it affects, and what outcome they want. Restate it back in one or two sentences to confirm shared understanding. Ask follow-ups for anything that would change the shape of the issue (scope, who it affects, dependencies on other work). Do not start drafting until you genuinely understand the ask.

2. **Let the user decide the type.** Every issue is an **epic**, **story**, **task**, or **bug** (see the guidelines doc). State which type you read the ask as and why, and let the user confirm or override — the type picks the template. Skip the question only when the type is unmistakable (e.g. the user said "bug" or described a clear defect).

3. **Research the codebase thoroughly.** Do real investigation of the current state — read relevant files, trace how the feature works today, understand the user-visible behavior end-to-end. The goal is to describe the status quo *accurately*, not superficially. A shallow understanding produces a vague ticket.

   **But keep the research out of the issue itself.** Do not pull file paths, function names, line numbers, data structures, or architectural detail into the draft. The research informs your writing; it does not appear in it. If a sentence only makes sense to someone who's read the code, rewrite it.

4. **For a story, task, or bug: consider an epic.** Fetch the epics from the project board and check whether one clearly fits:

   ```sh
   gh project item-list 1 --owner dam-agents --limit 3000 --format json \
     | jq -r '.items[] | select(.status=="Epics") | "#\(.content.number)  \(.title)"'
   ```

   If one does, read its body (`gh issue view <num> --repo dam-agents/dam`) to confirm, then put it on the draft's **Epic** line with a one-line justification. If nothing fits, leave the line out — placement can be decided later in triage. Epics themselves have no parent; skip this step.

5. **Decide output mode from the original prompt.** Read the user's initial ask and pick one:
   - **Draft only** — produce the draft using the type's template and present the full title + body inline in the chat. Stop.
   - **File right away** — hand off to the `file-issue` skill, which runs the dedupe → approve → file loop on top of the same draft.

   When in doubt, default to draft-only and ask whether to file.
