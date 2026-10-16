---
name: agent-case-study
description: >
  Generate a case study of this agent — a sanitized, one-page executive summary of the
  use case it serves, what it's worth, and how to replicate the setup. Use when a
  scheduled task or the user asks for a "case study", to "share your experience",
  "document how you work", or "summarize what you do and what it's worth". One-off
  job: publishes a Markdown artifact; writes nothing to the workspace.
---

The reader is a person at another company. They have two minutes to decide whether
to copy this setup. Transfer the craft, not the specifics of this deployment.

Four rules override everything else:

1. **Grounded**: Base each claim on real history. Count what a command can count.
   Label sampled numbers as approximate. If you cannot verify a number, say so.
2. **Sanitized**: Do not identify this company, its people, its systems, or its data.
3. **Plain**: Write in ASD-STE100. Short sentences, one idea each, active voice,
   everyday words, no filler. Explain jargon inline at first use. Do not open
   with a glossary.
4. **Honest**: Give facts, not adjectives. Include failures and wasted spend,
   without spin.

## Step 1: Mine your real history

Do a bounded survey, not an audit. Spend only a small part of the session on it.

- **Workspace**: Read CLAUDE.md, AGENTS.md, the READMEs, and the directory tree
  first. Then read your notes, memory files, daily logs, ledgers, project notes,
  state files, and installed skills.
- **Schedules**: Run `list_schedules`. Each schedule is part of the job.
- **Transcripts**: Read the on-disk session store (Claude Code:
  `~/.claude/projects/**/*.jsonl`). Cover the last 30 days. To classify sessions,
  write one small script that extracts each session's first real user message and
  skips harness wrappers. If the script fails twice, sample by hand. If subagents
  are available, send the in-depth reads to parallel read-only subagents that
  cover sessions spread across the window and across task types. If a sampled
  session holds nothing useful (trivial, aborted, empty), sample a replacement.
  Do not pad notes from it. Without subagents, read at most ~10 sessions
  yourself. Get numbers from your own commands, not from a subagent's summary.
- **Outputs**: Count what you produced in the window (posts, messages, items
  handled). Count in the real systems you act on.
- **Delivered value**: Collect evidence that the work helped the person or
  business served, in two strengths. Confirmed: reactions to your work — thanks,
  praise, a person says an output caught something or saved them time, output
  they used or built on, repeat requests. Inferred: outcomes that served the
  mission although nobody reacted — a deadline kept in view, a bug flagged
  before merge, a stalled item unblocked. Judge inferred outcomes against your
  mission. Present them as the outcome itself, not as a claim of credit. Also
  collect the misses: output ignored, corrected, or complained about.
  Paraphrase. Do not quote.
- **Cost**: Report only cost that data supports. Do not guess. With usage or
  billing data, calculate the 30-day total and the average per session, and name
  your inputs. Without it, token counts from the transcripts are a fallback
  scale signal. Report output tokens (work produced) separately from cache reads
  (context re-loaded each run). Do not report one summed total. Convert to
  dollars only when a price was provided.
- **Models**: Report which models did the work and the approximate split. Model
  names are safe to state as-is.

## Step 2: Sanitize (hard rules)

- Do not include secrets, PII (this includes the owner's identity), or verbatim
  quotes.
- Generalize, do not name: companies, products, vendors, channel/repo/ticket IDs,
  hostnames, URLs, project names, team names, and the domain data itself.
  Example: "#acme-eng-deploys" becomes "a team channel dedicated to deploy
  activity".
- The person served is a role, not a character. Describe the job. Use they/them.
  Do not use gendered pronouns. Do not give personal traits the use case does
  not need.
- Final gate: Read the finished document one more time. Ask two questions: "Can a
  sentence identify this company or a person?" and "Can an 18-year-old understand
  this?" Fix each hit. If you are not sure whether something identifies, treat it
  as if it does. Hold the Setup recipe and Gotchas to the same plain English as
  the opening.

## Step 3: Write and publish

Draft in a scratch location. Publish as a Markdown artifact. Do not write it into
the workspace. Do not update a previous edition.

Keep it to one page. Only the recipe may go onto a second page. Use tables for
enumerable facts and prose for behavior. Do not use em dashes in paragraphs. Give
results only, no methodology. Back a number with a one-line source note ("counted
from session-file timestamps"). If a section has no content, say so in one line.
Do not pad.

```
# Agent Case Study: <generalized role, e.g. "Support-triage agent for a SaaS product">
_Generated: <date> · Covers: <window, session count>_

## At a glance
A two-column table, five rows, bare facts. The first cell of each row is its
label (vertical headers, no header row). Each row expands into a section below:
- What · the job and who it serves
- Runs as · the mix of scheduled and on-demand work
- Headline value · the single strongest outcome for the person or business served
- Cost · rounded spend for the window, or "not measurable"
- Needs · the connections it relies on + human minutes per week

## Use case
3–5 sentences: the problem, who has it, what the work looked like before, what
"done well" means now.

## What it does
A table of recurring jobs: job · cadence · what one run produces. Give ongoing
upkeep (notes, ledgers, watch-lists) its own rows with cadence "ongoing". Then
show the flagship job as 3–5 numbered steps: what a run reads, gathers, decides,
produces, and where the output lands. Make each step copyable, not a story. Then
add a short paragraph on the 2–4 main on-demand request types. End with one
sentence: what runs unattended, and what waits for a human.

## Is it worth it
Give three inputs. Do not give a verdict.
- **Value:** at most 5 outcomes for the person or business served, one line each.
  Give outcomes, not output counts: "reviewed 90 changes" is scale; "caught a bug
  before it shipped" is value. Cite reception (paraphrased thanks, output acted
  on) as proof. Self-maintenance is never value. Put a transferable lesson from
  it in Gotchas.
- **Scale & cost:** sessions per week, counted outputs, rounded window spend
  (mark estimates), one or two averages, the model split, and the single biggest
  lever to lower spend.
- **Human time:** what the person puts in each week.

## Setup recipe
Numbered steps from zero that a person can follow as written: the workspace to
create; the seed files and the contents of each (the memory design lives here);
the connections; the skills; the schedules (cadence and the shape of each task
prompt); the first-session ritual; the standing rules that make unattended runs
safe (only rules this agent really enforces).

## Gotchas
At most 5 lessons from real failures, most transferable first, one line each:
what broke, then the fix, in plain English.
```

## Step 4: Report

Reply with the artifact link and one line on the window covered.
