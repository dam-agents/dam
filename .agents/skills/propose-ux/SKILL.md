---
name: propose-ux
description: >
  Propose the UX of a feature before anyone builds it.
  Understand the problem and the person first, explore several concepts that differ in what the person does, choose one against criteria fixed in advance, and specify its flow, states and copy in the words and components DAM already has.
  Use when an issue or idea changes what a person sees or does in the web UI, the dam CLI or a chat channel and no approved design exists yet, when an issue has the `needs design` label, or when the user asks "how should this work for the user", "propose a UX", "design this flow", "sketch the user flow", "wireframe this" or "write the copy for this screen".
  Not for building components (use react-ui-engineering), and not for the parts that a linked Figma frame already defines.
argument-hint: "<issue URL or number | description of the feature>"
---

# Propose UX

A good UX comes from a problem that someone understood, not from the first screen someone drew.
This skill makes the agent understand the problem and the person, compare more than one answer, and show its reasoning.
It ends with a proposal that the user can accept, change or reject.

## Principles

1. **Problem before screen.**
   No concept exists until the user has accepted the brief.
2. **Evidence, not invention.**
   The agent cannot interview users.
   Label every fact in the brief *observed*, *reported*, *inferred* or *assumed*.
   Never invent a persona, a quote or a number.
3. **Concepts differ in behavior.**
   Three concepts with the same steps and different looks are one concept.
4. **Criteria before concepts.**
   Fix what makes a concept win before you draw the first one.
5. **Reuse before inventing.**
   Build on an existing row, badge, section or dialog before you add a new device.
6. **Design the time the person is away.**
   An agent works when nobody watches.
   Most DAM features need states for working, waiting for the person, failed and done.
7. **Show what you rejected.**
   The reasons for the rejected concepts are half of the output.

## Process

| Phase       | Read                     | Output                                         | Stop                            |
| ----------- | ------------------------ | ---------------------------------------------- | ------------------------------- |
| 1. Explore  | `references/explore.md`  | The brief, with its criteria                   | Yes: the user accepts the brief |
| 2. Diverge  | `references/concepts.md` | Three concepts, and today's flow as a baseline | No                              |
| 3. Converge | `references/concepts.md` | A recommendation and a choice record           | Yes: the user chooses           |
| 4. Specify  | `references/specify.md`  | The spec of the chosen concept                 | No                              |

The two stops are the point.
A wrong direction costs little at the brief and at the choice, and much after the spec.
Read only what the phase needs.
`references/agent-lens.md` applies to phases 2 and 4 when an agent acts on its own.
The check in `references/specify.md` applies to phases 2 and 4.

Scale the work to the change.
A small change to one existing screen needs a brief of a few lines, two concepts and a short spec.
An issue that already has a proposed solution and criteria needs a three-line brief, and the first stop is one question.
Keep both stops.

## Start

1. Restate the request in one or two sentences, so the user can correct the reading.
2. Collect every design that already exists.
   - A linked Figma frame.
     It beats the prose: design only what it leaves open.
     If no frame is linked, ask whether one exists.
     Without the Figma tools, ask for an export.
   - A **Proposed solution** in the issue, an attached prototype, or acceptance criteria that already fix a solution.
     This is the concept to beat, never the brief.
     Ask whether the existing criteria are binding.
3. Do the research steps of the `develop` skill: duplicate issues, the history of the area, and whether today's behavior was a deliberate decision.
   Skip what the conversation already holds.
   Put the result in the brief in three lines.

## Facts the code does not state

- `.design-desk/dam/PROFILE.md` says who the people are, what the main screens are, and the design rules.
  Read it before you explore, and obey it in every concept.
- Users read the words in "Words users read" of `docs/ubiquitous-language.md`, and never a word from "Retired words".
- A feature can meet the person on more than one surface.
  The surfaces are the web UI, the `dam` CLI, Slack and Telegram.
  They also include the GitHub issues and pull requests that an agent writes, and shared pages (an artifact link, a public agent).
  Name the surfaces that the proposal covers and those that it leaves out.
  Read `docs/architecture/cli.md` and `docs/architecture/channels.md` before you write copy for them.
- Icons and tooltips follow `docs/guidelines/code/icons-and-tooltips.md`.
- A proposal can move a screen, rename a control or change a dialog.
  Then it lists the journeys and helpers in `.quality-inspector/qi-profile-dam/` that must change.
  It also lists the part of the Design Desk profile that must change.

## Deliver

Give the proposal in the conversation, in this order: brief, concepts, choice record, spec, open questions, files that must change.
Draw flows in Mermaid.
When a screen helps, draw a labelled wireframe and name the existing component for each part.
A live prototype is only for the chosen concept, and only when the user asks.
The Design Desk agent builds it with `.design-desk/dam/bin/env`.
This skill does not run that script.

Offer to post the proposal on the issue, and post it only after the user approves the exact text.
Posted text cites staging, never the cluster on your machine.
Write no file in the repository unless the user asks.

The proposal feeds `grill-me`.
Its flow and states become the observable outcomes of the acceptance criteria.
This skill does not write the criteria.
