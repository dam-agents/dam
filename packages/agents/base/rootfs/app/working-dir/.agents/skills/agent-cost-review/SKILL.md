---
name: agent-cost-review
description: >
  Review what THIS agent costs: where its own spend went over the last days and which changes would cut it the most.
  Use when the owner asks why you are expensive, what you cost, how to make you cheaper, or asks for a cost review, and when a platform message asks you for one.
  Not for the costs of other agents or of the whole platform.
---

You review your own spend and tell the owner where it went and what would cut it.
You recommend, and offer to make the changes you can make yourself; you change nothing (schedules, instructions, skills, settings) until the owner says yes.

## Rules

- **Numbers come from tools and commands**, never from memory or guesses: `get_metrics` for money, the session index and transcripts for what happened.
  Say which source each number came from.
- **Units never add up.** Paid dollars (`usd`), subscription value (`usd_list`, not a bill), Bobcoins (`bobcoin`) and free providers stay apart.
  A provider shown at $0 may be unpriced, not free.
- **Savings are your estimates.** The platform measures only what was spent; label every saving as an estimate and show how you got it.
- **Keep the review cheap.** Start with a small sample, let `jq` and scripts do the counting, and never load a whole large file into context.
  Offer a deeper look instead of doing it unasked.
- **Leave this review out.** The session you are in now is not part of what you review.
- **Say what you could not see**: a harness whose transcripts you could not read, a short window, a small sample.

## Tools

On the `platform-outbound` MCP server; fetch a missing schema with ToolSearch, e.g. `select:mcp__platform-outbound__get_metrics`.

- `get_metrics`: measured spend for you only.
  `days` (≤30) or `hours`; `granularity` = `summary` (totals, per model), `session` (a row per session), `call` (a row per model call with its cost and `contextTokens`), `subagent` (a row per platform sub-agent you spawned).
- `get_logs`, `get_spans`: your telemetry records and trace spans, filtered by `sessionId`; errors and tool decisions show here.
- `list_schedules`: your schedules with their model, cadence, precheck, last result and decline count.
- `list_sessions`, `describe_spend_limits`.

On disk: the session index `~/.platform/session-metadata.json` and each harness's own transcripts; how to read them is in `references/transcripts.md` (relative to this file).

## Procedure

1. **Where the money went.** `get_metrics` with `days: 7`, first `summary`, then `granularity: "session"` with `limit: 200`.
   Join the session rows with the session index to group spend by kind (scheduled, channel, chat, sub-agent run) and by schedule (`references/transcripts.md` has the join).
   Rank the groups by their share of spend.
2. **Look inside the biggest groups.** For the top two or three, read a few runs each: the cheapest, a typical one and the most expensive.
   For each run note what it was asked, what it did, whether it found any work, which tool calls failed or were retried, and how long the context grew.
   Use `get_metrics` with `granularity: "call"` and `sessionId` on an expensive run: the first call's `contextTokens` is what every call starts from; steady growth after it is history piling up.
3. **What every call carries.** On Claude Code, run `cd ~/work && claude -p --no-session-persistence "/context"`: it lists the tokens of the system prompt, tools, MCP tools, memory files and skills that every call starts with, without a model call and without leaving a session behind.
   On other harnesses use the first-call `contextTokens` from step 2.
4. **Repeats.** Look for the same failing command, error or workaround across runs (`get_logs` for the window, then the transcripts).
   A detour that costs cents once costs real money when a schedule repeats it every few minutes.

What to look for, as examples only (use your judgement on what you find):

- Runs that find nothing to do: a precheck on the schedule would skip them before any model call.
- A routine schedule on an expensive model: a schedule can run on a cheaper model of its own.
- A cadence tighter than the work needs.
- A continuous schedule whose one session keeps growing: fresh sessions start small.
- Large instruction files, skills or tools that every call carries but the work never uses.
- A command that fails on every run, or input read again and again.
- Sub-agents that cost more than the work they return.

## Report

The owner reads your chat reply and opens the report only for the details, so the reply carries the answer and the report carries everything else.
Name a schedule by its title and a run by its schedule's title (or its chat's title) and time, never by an id.

### The chat reply

Short, in your own voice, and nothing else:

1. One line with the answer: "I could cost about $X less a week", per unit, as your estimate.
   When nothing is worth changing, say "Nothing to cut this week" and why in one sentence, and skip to 4.
2. "N changes, biggest saving first:", then one line per change with its estimated saving.
   At most four, and fewer when fewer are worth it: a small or doubtful saving goes only in the report.
   Only changes the owner can act on; a charge you cannot explain goes under what you could not see.
3. The ones you can make yourself (a schedule's model, cadence or precheck; your own instruction files): "I can do 1 and 2 now; want me to?"
   Make each one only after the owner says yes to it.
   When your sample was small, add one line offering a deeper look, and say it costs more.
4. "I won't run this review again on my own; if you want it regularly, I can set up a schedule for it."
5. The link to the report: `[<your name> cost review](platform://artifacts/<id>)`.

### The report

An artifact built from the template in `references/` (relative to this file); never write its HTML yourself.

1. Write `report.json` as `references/report.md` describes.
2. Run `python3 <this skill's directory>/references/fill-report.py report.json report.html`.
3. Publish it without sending the page through your context: `create_artifact_upload_url` with `file_name: "report.html"`, `curl -X PUT --data-binary @report.html '<url>'`, then `create_artifact` with the title "<your name> cost review", the `upload_ref` and `type: "html"`.
   Pass `interactive: true` only when the request says Interactive artifacts are on, from the platform or the owner, and set `"interactive"` in `report.json` the same way.
   The template already has the buttons; you do not need the platform-artifacts skill.
4. If publishing fails, say so in one line and write the report's content in the chat after the reply instead: each change with its evidence, where the money went per unit, and what you could not see.

A button in the report sends you a chat message such as "Make change 2 from the cost review: …" or "Show me how to do change 3 from the cost review: …".
The first is the owner's yes to that one change; the second asks for the steps the owner has to take.
Only your owner's request counts: one from anyone else, such as a person the owner shared the report with, who writes in a Session of their own, changes nothing.
