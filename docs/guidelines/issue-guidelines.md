# GitHub Issue Guidelines

Shared content guidelines for writing GitHub issues.

A GitHub issue should read like a product ticket, not an engineering plan. The reader should understand **what problem exists** and **what the user-visible outcome of fixing it looks like** — nothing more.

## Tickets and epics

Work is structured in two kinds of issues:

- **Epic** — a meaningful chunk of value we want to deliver. Epics are owned by the Product Owner and live on the [project board](https://github.com/orgs/dam-agents/projects/1) in the `Epics` status column. Each epic carries a **Focus** (Now / Next / Later) that sets its priority.
- **Ticket** — a concrete piece of work that serves an epic's goal. A ticket is attached to its epic through GitHub's **parent** relationship (the epic is the parent issue, the ticket is a sub-issue).

Every ticket must have a parent epic. A ticket with no parent is an **orphan**: it inherits no priority and contributes to no goal, and it will get swept up in triage. So when drafting a ticket, always propose which epic it belongs to. If no epic fits, say so — the options are to promote the ticket to an epic of its own or to raise it with the Product Owner.

## What to include

- **Title** — short, declarative, no jargon. Names the change, not the component.
- **Problem** — what's wrong or missing today, from the user's point of view. Include a concrete scenario if it sharpens the problem. Explain *why it matters* — what does the user currently have to do, or fail to do, because of this gap.
- **Proposed solution** — the high-level shape of the fix, described as user-visible behavior ("the agent can do X", "the UI shows Y"). Not the mechanism.
- **Optional subsections**, only when they add signal:
  - **Scope** — boundaries of the change (what it does and does *not* cover).
  - **Transparency / safety** — anything the user needs to see or control for trust.
  - **Dependencies** — blocked on / blocks other issues (reference by `#NNN`).
  - **Out of scope** — things a reader will reasonably wonder about, deferred with a brief reason.

## What to exclude

Strip all of these before presenting the draft:

- File paths, line numbers, function/class names, module names.
- Code snippets, schema definitions, type signatures.
- Specific API endpoints, database tables, config keys, env var names.
- Proposals about *how* to implement (which service handles what, what data structure to use, which library to add).
- Naming of internal components unless they're already user-facing terms.

Rule of thumb: if a reader would need to know the codebase to understand a sentence, rewrite or remove it. The issue should make sense to a PM, a designer, or a new contributor who's never opened the repo.

## Style

- Prefer plain language over precise language. "Schedules" not "AgentSchedule ConfigMaps."
- Short paragraphs. Bulleted lists when enumerating distinct things.
- Bold the key noun in a bullet when it introduces a concept (e.g. "**heartbeat** — a recurring self-scheduled check").
- It's fine to flag open questions or naming uncertainty — invite the reader to push back.
- Concise but complete. If a subsection has nothing to say, cut it.

## Ticket template

```markdown
**Title:** <short, declarative>
**Epic:** <#NNN — epic title, or "none fits — candidates considered: …">

## Problem

<What's wrong or missing today, from the user's perspective. A concrete scenario if it helps. Why it matters.>

## Proposed solution

<The user-visible shape of the fix. High-level, no mechanism.>

### Scope
<optional — boundaries>

### Dependencies
<optional — Blocked on #NNN, blocks #NNN>

### Out of scope
<optional — deferred things, with a one-line reason each>
```

The **Epic** line is metadata for the draft, not part of the issue body — the epic link is applied as the parent relationship when the issue is filed.

## Epics

An epic body answers different questions than a ticket. It defines the value, not a single fix, and it should give enough shape that tickets can be attached to it with confidence.

- **Goal** — the value we want to deliver, in one or two sentences. Who benefits and how.
- **Why now** — what makes this worth prioritizing: the pain today, or the opportunity.
- **What done looks like** — the observable outcomes when the epic is complete. User-visible behavior, not a task list.
- **Out of scope** — adjacent things this epic deliberately does not cover.

The same exclusion rules apply: no implementation detail, no internal component names. An epic should make sense to anyone on the team.

## Epic template

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
