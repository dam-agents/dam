---
name: propose-ux
description: >
  Propose the UX of a feature together with the user, before anyone builds it.
  Understand the problem and the person first, explore several concepts that differ in what the person does, choose one against criteria fixed in advance, and specify its flow, states and copy in the words and components that the project already has.
  Use when an issue or idea changes what a person sees or does in a product (a web UI, a CLI, a chat channel, an API, an email) and no design exists yet, when an issue is marked as needing design, or when the user asks "how should this work for the user", "propose a UX", "design this flow", "sketch the user flow", "wireframe this" or "write the copy for this screen".
  Not for building the UI itself.
argument-hint: "<issue URL or number | description of the feature>"
---

# Propose UX

A good UX comes from a problem that someone understood, not from the first screen someone drew.
Run this skill with the user, in conversation.
The agent prepares and proposes, and the user decides at two stops.
The skill works in any project.
It uses the design rules, the words and the components that the project already has.

## Principles

1. **Problem before screen.**
   No concept exists until the user has accepted the brief.
2. **Evidence, not invention.**
   The agent cannot talk to the people who use the product, but the user can speak for them.
   Label every fact in the brief *observed*, *reported*, *inferred* or *assumed*.
   Never invent a persona, a quote or a number.
   Ask the user instead.
3. **Concepts differ in behavior.**
   Three concepts with the same steps and different looks are one concept.
4. **Criteria before concepts.**
   Fix what makes a concept win before you draw the first one.
5. **Reuse before inventing.**
   Build on a component, pattern or flow that the product already has before you add a new one.
6. **Show what you rejected.**
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
`references/agent-lens.md` applies to phases 2 and 4 when a feature has an agent or an automation that acts on its own.
The check in `references/specify.md` applies to phases 2 and 4.

Scale the work to the change.
A small change to one existing screen needs a brief of a few lines, two concepts and a short spec.
An issue that already has a proposed solution and criteria needs a three-line brief, and the first stop is one question.
Keep both stops.

## Start

1. Restate the request in one or two sentences, so the user can correct the reading.

2. Collect every design that already exists.
   - If the issue links a Figma frame, that frame is the design.
     Use this skill only for what it leaves open.
   - The issue can hold a proposed solution, an attached prototype, or criteria that already fix a solution.
     That design is the concept to beat, never the brief.
     Ask whether the existing criteria are binding.

3. Learn the project's context.
   Read the project instructions, for example `AGENTS.md`, `CLAUDE.md` or a contributing guide.
   Look for these sources, and obey them in every concept:
   - a design profile or UI guidelines;
   - a glossary of the words that users read, and the words that the project retired;
   - the component library, and its rules for icons and tooltips;
   - the docs of the subsystem that the feature touches;
   - tests or QA scripts that describe user flows.

   If `references/` holds a file for this project, read it too.
   `references/dam.md` is for the DAM repository.

4. Research the area: duplicate issues, the history of the area, and whether today's behavior was a deliberate decision.
   Skip what the conversation already holds.
   Put the result in the brief in three lines.

## Deliver

Give the proposal in the conversation, in this order: brief, concepts, choice record, spec, open questions, files that must change.
Draw flows in Mermaid.
When a screen helps, draw a labelled wireframe and name the existing component for each part.
Build a live prototype only for the chosen concept, and only when the user asks.

Offer to post the proposal where the work is tracked, and post it only after the user approves the exact text.
Write no file in the repository unless the user asks.

The proposal feeds the acceptance criteria.
Its flow and states become the observable outcomes of those criteria.
This skill does not write the criteria.
