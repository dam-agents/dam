# Work process

Proposed ideal — not a hard rule.

1. **Discuss** — chat with Claude to accumulate context.
2. **File issue** — `/file-issue`.
   Captures the problem statement, with **Done when** left as `TBD (after grilling)` and the `needs-ac` label.
3. **Grill** — `/grill-me`.
   Pressure-tests vocabulary and architecture against the project's docs and code, then writes the acceptance criteria into **Done when** and removes `needs-ac`.
4. **Implement** — use `/typescript-engineering` for server-side TS work and `/react-ui-engineering` for UI work.

## Acceptance criteria come after grilling

Filing an issue should be cheap.
Acceptance criteria written from a one-line problem statement tend to encode a guessed solution, get little review, and turn out needlessly restrictive only during implementation.
So the criteria are written once the grilling has settled the design, not when the issue is filed.

- **At filing**, **Done when** reads `TBD (after grilling)` and the issue gets the `needs-ac` label.
  When the requester supplies acceptance criteria themselves, the issue carries them, reformatted as in [acceptance-criteria.md](acceptance-criteria.md), and no label.
- **The grilling** ends by writing the criteria into **Done when** and removing `needs-ac`.
- **Criteria describe an observable outcome**, never the implementation that produces it.
- **An issue with `needs-ac`** does not move to In Progress and does not go to the QA agent until the label is removed.

## Keep in mind

- **Stress-test ideas with both humans and agents.** Agents catch inconsistencies with the codebase fast.
  Humans catch the bigger picture.
  You want both before committing to a direction.
- **State the problem clearly before the solution.** WHAT we're solving matters more than HOW we get there.
- **Keep the codebase architecturally consistent.** Inconsistency compounds.
  `/typescript-engineering` and `/react-ui-engineering` exist to keep new code coherent with the conventions the rest of the system already follows.
