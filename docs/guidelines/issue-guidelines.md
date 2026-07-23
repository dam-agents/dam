# GitHub Issue Guidelines

Shared content guidelines for writing GitHub issues.

A GitHub issue should read like a product ticket, not an engineering plan. The reader should understand **what problem exists** and **what the user-visible outcome of fixing it looks like** — nothing more.

## Issue types

Decide the type first — it picks the template. Every issue is one of:

- **Epic** — a meaningful chunk of value we want to deliver. Epics are owned by the Product Owner and live on the [project board](https://github.com/orgs/dam-agents/projects/1) in the `Epics` status column, each with a **Focus** (Now / Next / Later) that sets its priority.
- **Story** — a user-facing improvement: new behavior, or a change the user can see.
- **Task** — work that needs to happen but isn't user-facing: chores, tooling, upgrades, refactors.
- **Bug** — something that should work but doesn't.

Stories, tasks, and bugs can be attached to an epic through GitHub's **parent** relationship (the epic is the parent issue). If the issue clearly serves an existing epic, suggest it. If nothing fits, leave it out — placement can be decided later in triage.

## What to exclude

Strip all of these before presenting the draft:

- File paths, line numbers, function/class names, module names.
- Code snippets, schema definitions, type signatures.
- Specific API endpoints, database tables, config keys, env var names.
- Proposals about *how* to implement (which service handles what, what data structure to use, which library to add).
- Naming of internal components unless they're already user-facing terms.

Rule of thumb: if a reader would need to know the codebase to understand a sentence, rewrite or remove it. The issue should make sense to a PM, a designer, or a new contributor who's never opened the repo.

Tasks and bugs get some slack: a task often *is* engineering work, and a bug may need a precise trigger. Name what's necessary to act on the issue, in the plainest terms available, and nothing more.

## Style

- Prefer plain language over precise language. "Schedules" not "AgentSchedule ConfigMaps."
- Short paragraphs. Bulleted lists when enumerating distinct things.
- Bold the key noun in a bullet when it introduces a concept (e.g. "**heartbeat** — a recurring self-scheduled check").
- It's fine to flag open questions or naming uncertainty — invite the reader to push back.
- Concise but complete. If a subsection has nothing to say, cut it.

## Templates

Every template starts with a **Title** — short, declarative, no jargon; names the change, not the component. Stories, tasks, and bugs may carry an **Epic** line; it's metadata for the draft, not part of the issue body — the epic link is applied as the parent relationship when the issue is filed.

### Epic

An epic body defines the value, not a single fix, and gives enough shape that issues can be attached to it with confidence. It should make sense to anyone on the team.

```markdown
**Title:** <the value delivered, short and declarative>

## Goal

<The chunk of value this epic delivers. Who benefits and how.>

## Why now

<The pain or opportunity that makes this worth prioritizing.>

## What done looks like

<Observable outcomes when this epic is complete. User-visible, not a task list.>

### Out of scope
<optional — adjacent things deliberately not covered>
```

### Story

The **Problem** describes what's wrong or missing today, from the user's point of view — include a concrete scenario if it sharpens it, and explain *why it matters*. The **Proposed solution** is the high-level shape of the fix as user-visible behavior ("the agent can do X", "the UI shows Y"), not the mechanism.

```markdown
**Title:** <short, declarative>
**Epic:** <#NNN — epic title, if one clearly fits>

## Problem

<What's wrong or missing today, from the user's perspective. A concrete scenario if it helps. Why it matters.>

## Proposed solution

<The user-visible shape of the fix. High-level, no mechanism.>

### Scope
<optional — boundaries: what it does and does not cover>

### Transparency / safety
<optional — anything the user needs to see or control for trust>

### Dependencies
<optional — Blocked on #NNN, blocks #NNN>

### Out of scope
<optional — deferred things, with a one-line reason each>
```

### Task

A task states the work and what it unblocks. It's the one type where naming engineering work is expected — keep it as plain as the work allows.

```markdown
**Title:** <short, declarative>
**Epic:** <#NNN — epic title, if one clearly fits>

## What

<The work to be done, in plain language.>

## Why

<What it unblocks or improves. Why it's worth doing now.>

## Done when

<The observable end state — how we know it's finished.>
```

### Bug

Lead with observed vs expected behavior. Reproduction steps should be minimal and numbered.

```markdown
**Title:** <short, declarative — the misbehavior, not the suspected cause>
**Epic:** <#NNN — epic title, if one clearly fits>

## What happens

<The observed behavior. A concrete scenario.>

## What should happen

<The expected behavior.>

## Steps to reproduce

1. <minimal, numbered steps>

### Impact
<optional — who is affected, how badly, any workaround>
```
