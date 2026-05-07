---
name: draft-issue
description: >
  Template and writing guidelines for a GitHub issue that defines a problem and proposes a high-level solution from the user's perspective, with no implementation details.
---

# Draft an Issue

Follow [docs/guidelines/issue-guidelines.md](../../../docs/guidelines/issue-guidelines.md) for what to include, what to exclude, style, and the template.

## Workflow

1. **Understand the request thoroughly.** Read the user's prompt carefully — multiple times if it's long or ambiguous. Identify what problem they're describing, who it affects, and what outcome they want. Restate it back in one or two sentences to confirm shared understanding. Ask follow-ups for anything that would change the shape of the issue (scope, who it affects, dependencies on other work). Do not start drafting until you genuinely understand the ask.

2. **Research the codebase thoroughly.** Do real investigation of the current state — read relevant files, trace how the feature works today, understand the user-visible behavior end-to-end. The goal is to describe the status quo *accurately*, not superficially. A shallow understanding produces a vague ticket.

   **But keep the research out of the issue itself.** Do not pull file paths, function names, line numbers, data structures, or architectural detail into the draft. The research informs your writing; it does not appear in it. If a sentence only makes sense to someone who's read the code, rewrite it.

3. **Decide output mode from the original prompt.** Read the user's initial ask and pick one:
   - **Draft only** — produce the draft following the guidelines and present the full title + body inline in the chat. Stop.
   - **File right away** — hand off to the `file-issue` skill, which runs the dedupe → approve → file loop on top of the same draft.

   When in doubt, default to draft-only and ask whether to file.
