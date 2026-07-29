# GitHub Issue Guidelines

Shared content guidelines for writing GitHub issues.

A GitHub issue should read like a product ticket, not an engineering plan. The reader should understand **what problem exists** and **what success looks like** — enough context to see *why it matters*, without being told *how to build it*.

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

The **Problem** describes what's wrong or missing today from the user's point of view — a concrete scenario if it sharpens it, and why it matters. The **Goal** is what success looks like as user-visible outcome. The **User Stories** break the goal into the concrete things different users want to do and why. Keep it problem-first: if you have a solution in mind, put it under **Proposed solution** and explain the reasoning — otherwise leave it open.

```markdown
**Title:** <short, declarative>
**Epic:** <#NNN — epic title, if one clearly fits>

## Context

<Why we're doing this. What led here.>

## Problem

<What's wrong or missing today, from the user's perspective. A concrete scenario if it helps. Why it matters.>

## Goal

<What success looks like — the user-visible outcome, not the mechanism.>

## User Stories

<The value from each user's perspective, in the form "As a <role>, I want <capability> so that <benefit>." One per distinct need. For example: "As an operator, I want to see a schedule's last run status so that I can tell at a glance whether it's healthy.">

- As a <role>, I want <capability> so that <benefit>.

## Scope

<optional — what's included and what's not>

## Proposed solution

<optional — the shape of a solution, if you have one. State it only if you show why, so others can reach the same conclusion; otherwise leave it open and let discussion get there.>

## Open Questions

<optional — decisions the team needs to make>

## Additional resources

<optional — links to designs, research, related issues, docs, or other supporting material>
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

A research task defines what we need to learn and why, before committing to build. The value is the knowledge it produces, so it's done when it produces an answer someone can act on — not when "research happened."

```markdown
**Title:** <short, declarative — the question, not the answer>
**Epic:** <#NNN — epic title, if one clearly fits>

## Context

<Why we're researching this. What decision or problem led here.>

## Research Goal

<What we want to learn, in one or two sentences.>

## Research Questions

- <the specific questions this research must answer>

## Users / Audience

<Who or what we're learning about.>

## Sources of Insight

- <how we'll gather evidence: interviews, analytics, competitive research, support data, existing research>

## Decision it informs

<What choice or work this research unblocks — why we need the answer now, and what we'll do differently depending on what we find.>

## Done when

<The observable end state — the answer, recommendation, or artifact produced, and where it lands.>

## Additional resources

<optional — links to existing research, related issues, docs, or other supporting material>
```
