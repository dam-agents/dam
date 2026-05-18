# Work process

Proposed ideal — not a hard rule.

1. **Discuss** — chat with Claude to accumulate context.
2. **Grill** — `/grill-with-adr`. Pressure-tests vocabulary and architecture; files an ADR PR when the decision warrants it.
3. **File issue** — `/file-issue`. Captures the problem statement; references the ADR PR if one exists.
4. **Implement** — once any ADR PR is merged. Use `/typescript-engineering` for server-side TS work and `/react-ui-engineering` for UI work.

## Keep in mind

- **Capture important decisions as ADRs.** If a choice is hard to reverse or a future reader will wonder why we did it this way, write it down. Skip the ADR for everything else.
- **Stress-test ideas with both humans and agents.** Agents catch inconsistencies with the codebase and existing ADRs fast. Humans catch the bigger picture. You want both before committing to a direction.
- **Every draft ADR sits on top of a ticket.** The ticket states the problem clearly; the ADR proposes how to solve it. WHAT we're solving matters more than HOW we get there.
- **Keep the codebase architecturally consistent.** Inconsistency compounds. `/typescript-engineering` and `/react-ui-engineering` exist to keep new code coherent with the conventions the rest of the system already follows.
