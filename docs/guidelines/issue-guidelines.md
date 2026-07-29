# GitHub Issue Guidelines

Shared content guidelines for writing GitHub issues.

A GitHub issue should read like a product ticket, not an engineering plan. The reader should understand **what problem exists** and **what success looks like** — enough context to see *why it matters*, without being told *how to build it*.

On solutions: usually it's best to state the problem and invite discussion. But if you're confident in an outcome, you may state it — as long as you show the reasoning, so someone else can follow it to the same conclusion. The problem to avoid isn't proposing a solution; it's an *unexplained* one that shuts down discussion before it starts.

Keep it concise and easy to digest.

## Which type?

Decide the type first — it picks the template and acts as a signal for what kind of work this is. Every issue is one of:

- **Epic** — coordinate a chunk of value across multiple issues. Owned by the Product Owner.
- **Feature** — build something a user can see.
- **Task** — do necessary work a user won't see: chores, tooling, upgrades, refactors.
- **Bug** — fix something that should work but doesn't.
- **Research Task** — learn something we don't yet know, before committing to build.

Features, tasks, bugs, and research tasks can attach to an epic. If the issue clearly serves an existing epic, suggest it; if nothing fits, leave it out. Epics have no parent.

## Style

- Prefer plain language over precise language. "Schedules" not "AgentSchedule ConfigMaps."
- Short paragraphs. Bulleted lists when enumerating distinct things.
- Bold the key noun in a bullet when it introduces a concept (e.g. "**heartbeat** — a recurring self-scheduled check").
- It's fine to flag open questions or naming uncertainty — invite the reader to push back.
- Concise but complete. If a subsection has nothing to say, cut it.

## Templates

Every template starts with a **Title** — short, declarative, no jargon; names the change, not the component. Every template then leads with **Context** — why we're here, what led to this. Features, tasks, bugs, and research tasks may carry an **Epic** line; it's metadata for the draft, not part of the issue body — the epic link is applied when the issue is filed.

### Epic

An epic defines the value, not a single fix, and gives enough shape that issues can be attached to it with confidence. It should make sense to anyone on the team. The **Problem** is the most important part — spend the effort there.

```markdown
**Title:** Epic - <the value delivered, short and declarative>

## Context

<Why we're investing here. What user or business problem led to this.>

## Problem

<The pain or opportunity this epic addresses. Who is affected and why it matters. This is the most important part.>

## Goal

<The outcome we want. Who benefits and how.>

## Scope

<What's included and what's not.>

## Open Questions

<Key decisions or unknowns.>
```

### Feature

The **Problem** describes what's wrong or missing today from the user's point of view — a concrete scenario if it sharpens it, and why it matters. The **Goal** is what success looks like as user-visible outcome. Keep it problem-first: if you have a solution in mind, put it under **Proposed solution** and explain the reasoning — otherwise leave it open.

```markdown
**Title:** <short, declarative>
**Epic:** <#NNN — epic title, if one clearly fits>

## Context

<Why we're doing this. What led here.>

## Problem

<What's wrong or missing today, from the user's perspective. A concrete scenario if it helps. Why it matters.>

## Goal

<What success looks like — the user-visible outcome, not the mechanism.>

## Scope

<optional — what's included and what's not>

## Proposed solution

<optional — the shape of a solution, if you have one. State it only if you show why, so others can reach the same conclusion; otherwise leave it open and let discussion get there.>

## Notes

<optional — constraints, research, designs, technical considerations, dependencies, out of scope>

## Open Questions

<optional — decisions the team needs to make>
```

### Task

A task states the work and what it unblocks. It's the one type where naming engineering work is expected — keep it as plain as the work allows.

```markdown
**Title:** <short, declarative>
**Epic:** <#NNN — epic title, if one clearly fits>

## Context

<Why this needs doing now.>

## Problem

<The work to be done, in plain language, and what it unblocks or improves.>

## Goal

<The outcome we want.>

## Done when

<The observable end state — how we know it's finished.>
```

### Bug

Lead with observed vs. expected behavior. Reproduction steps should be minimal and numbered.

```markdown
**Title:** <short, declarative — the misbehavior, not the suspected cause>
**Epic:** <#NNN — epic title, if one clearly fits>

## Context

<Environment, frequency, screenshots, logs, related issues.>

## Problem

<What's broken, and the user impact.>

## Expected Behavior

<What should happen.>

## Actual Behavior

<What happens instead.>

## Steps to Reproduce

1. <minimal, numbered steps>
```

### Research Task

A research task defines what we need to learn and why, before committing to build. The value is the knowledge it produces.

```markdown
**Title:** <short, declarative — the question, not the answer>
**Epic:** <#NNN — epic title, if one clearly fits>

## Context

<Why we're researching this. What decision or problem led here.>

## Research Goal

<What we want to learn.>

## Research Questions

- <what this research should answer>

## Sources of Insight

- <how we'll gather evidence: interviews, analytics, competitive research, support data, existing research>

## Users / Audience

<Who or what we're learning about.>

## Considerations

<optional — constraints, assumptions, existing insights, related work>
```
