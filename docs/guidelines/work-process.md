# Work process

Proposed ideal — not a hard rule.

1. **Discuss** — chat with Claude to accumulate context.
2. **Grill** — `/grill-me`. Pressure-tests vocabulary and architecture against the project's docs and code.
3. **File issue** — `/file-issue`. Captures the problem statement.
4. **Implement** — use `/typescript-engineering` for server-side TS work and `/react-ui-engineering` for UI work.

## Keep in mind

- **Stress-test ideas with both humans and agents.** Agents catch inconsistencies with the codebase fast. Humans catch the bigger picture. You want both before committing to a direction.
- **State the problem clearly before the solution.** WHAT we're solving matters more than HOW we get there.
- **Keep the codebase architecturally consistent.** Inconsistency compounds. `/typescript-engineering` and `/react-ui-engineering` exist to keep new code coherent with the conventions the rest of the system already follows.
