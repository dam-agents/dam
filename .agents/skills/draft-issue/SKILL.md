---
name: draft-issue
description: >
  Template and writing guidelines for a GitHub issue. Every issue is one of epic, feature, task, bug, or research task — the user decides the type, and each type has its own template. Non-epic types can suggest a parent epic from the project board.
---

# Draft an Issue

Content shape: all of [docs/guidelines/issue-guidelines.md](../../../docs/guidelines/issue-guidelines.md).

## Workflow

1. **Understand the request.** Identify the problem, who it affects, and the outcome wanted. Restate it in one or two sentences, and ask follow-ups for anything that would change the issue's shape (scope, who it affects, dependencies) before drafting. **Context leads every template** (why this matters, what led here): if the ask doesn't convey it, ask for it. A ticket without real context is what this step prevents.

2. **Let the user decide the type**: epic, feature, task, bug, or research task (see the guidelines). Say which you read the ask as and why; the user confirms or overrides, and the type picks the template. Skip the question only when the type is unmistakable (e.g. the user said "bug" or described a clear defect).

3. **Research the codebase.** Trace how the feature works today and its user-visible behavior end-to-end, so the issue describes the status quo accurately. **Keep the research out of the issue**: no file paths, function names, line numbers, data structures or architectural detail. A sentence that only makes sense to someone who has read the code gets rewritten.

4. **Non-epic types: consider an epic.** List the board's epics:

   ```sh
   gh project item-list 1 --owner dam-agents --limit 3000 --format json \
     | jq -r '.items[] | select(.status=="Epics") | "#\(.content.number)  \(.title)"'
   ```

   If one clearly fits, confirm by reading its body (`gh issue view <num> --repo dam-agents/dam`) and put it on the draft's **Epic** line with a one-line justification. Otherwise omit the line; triage can place it later. Epics have no parent.

5. **Output mode, from the original prompt:**
   - **Draft only**: present the full title + body inline, using the type's template. Stop.
   - **File right away**: hand off to the `file-issue` skill (dedupe → approve → file on the same draft).

   When unsure, draft only and ask whether to file.
