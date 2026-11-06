---
name: propose-ux
description: >
  Propose the UX of a DAM feature together with the user, before anyone builds it.
  Understand the problem and the person first, compare concepts that differ in what the person does or learns, against criteria fixed in advance, and specify the chosen one in the words and components that DAM already has.
  Use when an issue or idea changes what a person sees or does in DAM (the web UI, the CLI, Slack, Telegram, or what an agent posts) and no design exists yet, when an issue has the `needs design` label, or when the user asks "how should this work for the user", "propose a UX", "design this flow", "wireframe this" or "write the copy for this screen".
  Not for building the UI itself.
argument-hint: "<issue URL or number | description of the feature>"
---

# Propose UX

A good UX comes from a problem that someone understood, not from the first screen someone drew.
Run this skill with the user, in conversation.
The agent prepares, asks and proposes.
The user answers the interview, and decides at two stops: the brief and the choice.
A wrong direction costs little at a stop, and much after the spec.

## Principles

1. **Problem before screen.**
   No concept exists until the user has accepted the brief.
2. **Evidence, not invention.**
   The agent cannot talk to the people who use the product, but the user can speak for them.
   Never invent a persona, a quote or a number.
   Ask the user instead.
3. **Concepts differ in what the person does or learns.**
   Two concepts are one concept when the person takes the same steps and learns the same things at each step.
4. **Criteria before concepts.**
   A criterion that you add after you see the concepts describes the concept that you already prefer.
5. **Reuse before inventing.**
   Build on a component, pattern or flow that the product already has.
6. **Show what you rejected.**
   The reasons for the rejected concepts are half of the output.

Scale the work to the change.
A small change to one screen needs a few lines per phase.
Keep both stops, but a stop can be one question.

Keep a record in a file outside the repository (the session scratchpad, or a temporary file): each answer of the user, the brief and the choice record.
Add to it after each answer and at each stop.
A long session can lose its early messages, so build step 6 from this file.

## 1. Explore

Restate the request in one or two sentences, so the user can correct the reading.

Do the homework before you ask anything:

- Read `.design-desk/dam/PROFILE.md`: the people, the main screens, the design rules, the words and the components.
  Then read the architecture page of the area under `docs/architecture/`.
  Make each concept agree with both.
  When a concept breaks a design rule or changes the behavior that the page describes, say so, and count it as a cost.
- Collect the designs that already exist.
  A linked Figma frame is the design: use this skill only for what it leaves open.
  If you cannot open the frame, ask the user for a screenshot.
  A solution or a prototype that the issue proposes is the concept to beat.
  Criteria in the issue go into the brief: ask whether they are binding.
- Research the area as in step 1 of the `develop` skill: duplicate issues, the history, and whether today's behavior was a deliberate decision.
- Walk today's flow in the running app as the person, and keep a screenshot of each step as the "before".
  When the app cannot run here at a fair cost, read the code path instead, and say so.
- List where the area shows today on each surface: the web UI, the `dam` CLI, Slack, Telegram, the GitHub issues and pull requests that an agent writes, and shared pages (an artifact link, a public agent).
- When the adoption funnel or the use of a feature matters, ask the user for a read of the usage analytics (`docs/architecture/usage-tracking.md`).
  Only the `platform-inspector` role can read them.
- Look at how other products solve the same job.
  Cite a URL for each one, or label it *Assumed*.

Then interview the user about what the sources do not settle.
Ask one question at a time, with your recommended answer.
Start with the assumptions that the design depends on.
Stop when no remaining answer can change a criterion.
The rest go into the brief as open assumptions.

Label each fact in the brief:

- *Observed*: you saw it in the product, the code, the docs or data.
  Cite the source.
- *Reported*: someone says it, in an issue, a message or this conversation.
  Name who.
  The claims of an issue are reported, not observed.
- *Assumed*: nothing backs it.

Write the brief:

- **Problem**: what happens, to whom, and with what consequence.
  No solution in this line.
- **Person and job**: who it is, what happened just before, and *When \[situation\], I want to \[motivation\], so I can \[outcome\].*
  Two jobs are two pieces of work: take the main one first.
- **Path today**: the steps, including workarounds outside the product.
  Mark each place where the person waits, guesses, leaves or asks someone.
- **Criteria**: outcomes that a person can observe, each able to fail a concept.
  Mark each as a *threshold* (a concept that fails it is out) or a *trade-off* (weighed against the others).
  "A new person sends a first message after three choices at most" can fail; "feels simple" cannot.
  Add the design rules that apply to this change, as trade-offs; the user can make one a threshold.
  The cost to build is always a trade-off.
- **Out of scope**: what this proposal does not touch.
- **Open assumptions**: what remains, and who can answer each one.

## 2. Stop: the brief

Show the brief, and end your message there.
Do not start the concepts in the same message.

- The user accepts the brief: go to step 3.
- The user corrects it: change the brief, and show it again.
- The brief shows no problem worth a change: say so, and recommend that the work stops.
- The request is a research question, for example how people move between agents: concepts cannot answer it.
  Propose how to get the evidence, for example a read of the usage analytics or talks with the people who use the product, and stop there.
- The flow is already fixed, for example a copy-only change or a binding design: say so here.
  When the user accepts, go to step 5.

## 3. Concepts

Write the question that the concepts must answer.
Then sketch two or three concepts.
Keep today's flow as the baseline; it does not count as a concept.
The concept to beat from step 1 counts as one of them.
The concepts must differ in what the person does or learns:

- *Sequence*: what is asked first and what waits.
- *Unit of interaction*: one item, a batch or a stream.
- *Division of labor*: what the person decides and what the system decides.
- *Entry point*: where the task begins and what it assumes the person knows.
- *Commitment point*: how far the person goes before the action cannot be undone.
- *Information*: what the person learns at each step, and where they see it.

For each concept, give the one thing that it tests, the numbered steps that the person takes, and what it costs the person and the build.
Use the same fidelity for all.
Do not write a weak concept to make another one win.

Score every concept and the baseline against the criteria from the brief.
Recommend one, say what it gives up, and say what would make you reconsider.
If two concepts each win on a different criterion, say so, and ask the user at step 4 to rank the criteria.
Do not average the two.
For each rejected concept, record what it tested, what it lost on, and what would bring it back.
A choice inside one concept, for example which items carry a mark, is not a new concept.
Put it in the choice record as a sub-decision, with your recommended answer.

## 4. Stop: the choice

Show the recommendation and the choice record, and end your message there.

- The user chooses a concept: go to step 5.
- The user asks for a hybrid: score it against the same criteria, and show the result.
- The user rejects every concept: ask why.
  When a criterion is wrong, correct the brief and go back to step 2; otherwise, sketch new concepts.

## 5. Specify

Give the builder a flow that leaves no question for the builder to answer alone:

- **Flow**: numbered steps, with the branches in Mermaid.
- **States** of each screen or surface, for example empty, loading, partial, error, done and no permission.
  Every state has a way out.
  Say how each screen works at phone width.
- **Data**: what each state shows, where it comes from, and whether that data exists today.
- **Errors**: prevent them first.
  When one still happens, say what happened, what it affects and how to recover.
- **Words**: the glossary and the existing copy, never a retired word.
  Never write the brand as a literal: it comes from configuration.
  Write `<brand.name>` in text that a person reads, and `<brand.short>` only in commands, handles and URLs.
- **Surfaces**: for each surface from step 1, say what the person sees, or that the surface is out of scope.
- **Components**: the existing component for each part, in a labelled wireframe when a screen helps.
  Take the icons from `docs/guidelines/code/icons-and-tooltips.md`.
  Where no component fits, say what is new and why.
  Reuse the size of the existing component, or ask the user for the numbers.
  Never take a size from a screenshot.

When an agent or an automation acts on its own, also say:

- What it does alone, what it reports, and what waits for approval.
- What the person sees when they return after hours.
  Reuse Home and its approvals banner, the activity in the sidebar, the unread and approval dots, and the approvals bell and its drawer before you add a new device (`docs/architecture/home-feed.md`).
- What the person sees while the agent wakes, and when the wake fails.
  An idle agent hibernates on its own.
  A message, a schedule fire or an opened chat wakes it after a delay.
  After a failed wake, the chat shows a Start button and the session list shows a retry (`docs/architecture/agent-lifecycle.md#wake`).
- What happens when nobody answers.
  An irreversible action never proceeds in silence.
- How each failure recovers.
  No failure ends in a dead end.

A prompt that people always click through is a defect.

Check the spec as a first-time person and as a returning one, against Nielsen's heuristics and the design rules.
Fix each problem that the spec can fix, and list the others as open questions.
When a fix changes what the person does or learns, go back to step 4.
Name the signal that will show that the change works, or say that none exists.

## 6. Deliver

Build the proposal from your record file, and give it in the conversation: the brief, the concepts, the choice record, the spec, the open questions with who answers each, and what must change with it.
What must change includes the QA journeys and helpers in `.quality-inspector/qi-profile-dam/`, the design profile in `.design-desk/dam/`, the architecture pages whose behavior changes, and the words that the glossary needs.
Build a live prototype only for the chosen concept, and only when the user asks.
Offer to post the proposal as a comment on the issue, and post it only after the user approves the exact text.
Posted text cites staging, never the cluster on your machine.
Write no file in the repository unless the user asks.

The `grill-me` skill writes the acceptance criteria from the proposal: its criteria and states are their draft.
This skill does not write the acceptance criteria.
