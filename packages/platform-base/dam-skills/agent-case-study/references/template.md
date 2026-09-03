# The document skeleton

Follow this structure exactly. Text in angle brackets is what you write; the
guidance under each section is for you, not for the document.

```
# Agent Case Study: <generalized role, e.g. "Support-triage agent for a SaaS product">
_Generated: <date> · Covers: <window>, <session count> sessions_

## At a glance

## Use case

## What it does

## Is it worth it

## Platform friction

## Setup recipe

## Gotchas
```

## At a glance

A two-column table, six rows, bare facts. The first cell of each row is its
label (vertical headers, no header row). Each row expands into a section below:

- What · the job and who it serves
- Runs as · the mix of scheduled and on-demand work
- Headline value · the single strongest outcome for the person or business served
- Cost · rounded spend for the window, or "not measured on this install"
- Needs · the connections it relies on + human minutes per week
- Friction · the single worst thing the platform put in the way, or "none worth naming"

## Use case

3–5 sentences: the problem, who has it, what the work looked like before, what
"done well" means now.

## What it does

A table of recurring jobs: job · cadence · what one run produces. Give ongoing
upkeep (notes, ledgers, watch-lists) its own rows with cadence "ongoing". Then
show the flagship job as 3–5 numbered steps: what a run reads, gathers,
decides, produces, and where the output lands. Make each step copyable, not a
story. Then add a short paragraph on the 2–4 main on-demand request types. End
with one sentence: what runs unattended, and what waits for a human.

## Is it worth it

Give three inputs. Do not give a verdict.

- **Value:** at most 5 outcomes for the person or business served, one line
  each. Give outcomes, not output counts: "reviewed 90 changes" is scale;
  "caught a bug before it shipped" is value. Cite reception (paraphrased
  thanks, output acted on) as proof. Self-maintenance is never value; a
  transferable lesson from it goes in Gotchas.
- **Scale & cost:** sessions this week, counted outputs, the window's spend and
  model split from the platform's own numbers (mark anything approximate), one
  or two averages, and the single biggest lever to lower spend.
- **Human time:** what the person puts in each week.

## Platform friction

3–5 items, worst first, one line each: what the owner or agent was trying to
do, what the platform put in the way, then the workaround, or "no workaround".
Include things the owner wanted and could not have. Platform feature names are
expected here; company and product names are not. If the window had no
friction, say so in one line.

## Setup recipe

Numbered steps from zero that a person can follow as written: the agent to
create (name the harness image); the seed files and the contents of each (the
memory design lives here); the connections; the skills; the schedules (cadence
and the shape of each task prompt); the first-session ritual; the standing
rules that make unattended runs safe (only rules this agent really enforces).

## Gotchas

At most 5 lessons from real failures, most transferable first, one line each:
what broke, then the fix, in plain English. Platform defects do not belong
here — they go under Platform friction; Gotchas are craft the next person
copies.
