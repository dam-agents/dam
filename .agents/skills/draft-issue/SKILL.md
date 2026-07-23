---
name: draft-issue
description: >
  Template and writing guidelines for a GitHub issue — a ticket that defines a problem and proposes a high-level solution from the user's perspective, or an epic that defines a chunk of value. Tickets get a proposed parent epic from the project board.
---

# Draft an Issue

Follow [docs/guidelines/issue-guidelines.md](../../../docs/guidelines/issue-guidelines.md) for what to include, what to exclude, style, and the templates. That doc also defines the concepts used here: epics, tickets, the parent relationship, and orphans.

## Workflow

1. **Understand the request thoroughly.** Read the user's prompt carefully — multiple times if it's long or ambiguous. Identify what problem they're describing, who it affects, and what outcome they want. Restate it back in one or two sentences to confirm shared understanding. Ask follow-ups for anything that would change the shape of the issue (scope, who it affects, dependencies on other work). Do not start drafting until you genuinely understand the ask.

2. **Decide: ticket or epic.** Most requests are tickets — a concrete problem with a concrete fix. If the ask reads like a meaningful chunk of value with several pieces of work inside it (or the user says "epic"), it's probably an epic. When it's not obvious, ask the user which one they mean before drafting. The two use different templates (see the guidelines doc).

3. **Research the codebase thoroughly.** Do real investigation of the current state — read relevant files, trace how the feature works today, understand the user-visible behavior end-to-end. The goal is to describe the status quo *accurately*, not superficially. A shallow understanding produces a vague ticket.

   **But keep the research out of the issue itself.** Do not pull file paths, function names, line numbers, data structures, or architectural detail into the draft. The research informs your writing; it does not appear in it. If a sentence only makes sense to someone who's read the code, rewrite it.

4. **For a ticket: find its epic.** Every ticket needs a parent epic — a ticket without one is an orphan. Fetch the epics from the project board and match the ticket against their titles and bodies:

   ```sh
   gh project item-list 1 --owner dam-agents --limit 3000 --format json \
     | jq -r '.items[] | select(.status=="Epics") | "#\(.content.number)  \(.title)"'
   ```

   Read the body of any plausible candidate (`gh issue view <num> --repo dam-agents/dam`) before committing. Put the recommendation on the draft's **Epic** line with a one-line justification. If no epic fits, say so explicitly, list the closest candidates you rejected, and flag the options: promote the ticket to an epic of its own, or raise it with the Product Owner. Never silently draft an orphan.

   Skip this step when drafting an epic — epics have no parent.

5. **Decide output mode from the original prompt.** Read the user's initial ask and pick one:
   - **Draft only** — produce the draft following the guidelines and present the full title + body inline in the chat (including the Epic line for tickets). Stop.
   - **File right away** — hand off to the `file-issue` skill, which runs the dedupe → approve → file loop on top of the same draft.

   When in doubt, default to draft-only and ask whether to file.
