---
name: agent-case-study
description: >
  Produce this agent's case study — a sanitized, plain-English, one-page account
  of the use case it serves, what it delivered, what it cost, and where the
  platform got in the way — then submit it to the platform as a pending edition
  only the owner can see. Use only when a scheduled task or the owner explicitly
  asks for a case study ("case study", "share your experience", "document how
  you work", "summarize what you do and what it's worth"). Never start one on
  your own initiative.
---

You write one document: a plain-English, one-page case study of this agent. It
covers the use case the agent serves, what it delivered, what it cost, and where
the platform got in the way. You then submit it to the platform, where only the
owner can see it until they release it.

Two readers get it. Someone with two minutes who wants to know whether to run a
setup like this one — give them the craft, not the particulars of this
deployment. And the platform team, who read it to learn what worked and where
the platform got in the way.

Keep it general for both of them. An account of the use case is useful to
someone else; an account full of this deployment's names is not. Anonymizing is
good practice on top of that.

Four rules override everything else:

1. **Grounded**: Base each claim on real history. Count what a command can
   count. Label sampled numbers as approximate. If you cannot verify a number,
   say so.
2. **Sanitized**: Do not identify this company, its people, its systems, or its
   data.
3. **Plain**: Write in ASD-STE100. Short sentences, one idea each, active
   voice, everyday words, no filler. Explain jargon inline at first use. Do not
   open with a glossary.
4. **Honest**: Give facts, not adjectives. Include failures and wasted spend,
   without spin.

## Ground rules for the run

- This file sits in a directory that also holds `scripts/` and `references/`.
  Resolve those paths relative to this file, wherever it is installed.
- You run unattended. Never ask a question mid-run. If evidence is thin, write
  the honest thin version and say what is missing.
- Do a bounded survey, not an audit. Spend only a small part of the session on
  mining.
- If you find no conversational history at all — no platform session index, no
  harness session store with sessions in the window — reply that there is
  nothing to summarize and stop. Submit nothing. A quiet week is a normal
  outcome, not a failure: never pad an edition to fill one.
- The platform tools this skill uses live on the `platform-outbound` MCP
  server: `submit_case_study`, `get_usage_summary`, `list_schedules`,
  `list_artifacts`, `create_artifact`, `update_artifact`. If a tool's schema is
  not loaded, fetch it with ToolSearch, e.g.
  `select:mcp__platform-outbound__submit_case_study,mcp__platform-outbound__get_usage_summary`.

## Step 1: Mine your real history

Cover the last 7 days. Set the window first: `window_start` is 7 days ago,
`window_end` is today, both as `YYYY-MM-DD`.

**Sessions — start from the platform index.** Read
`$HOME/.platform/session-metadata.json`. It is harness-agnostic and lists every
session the platform has seen: `sessions` is keyed by session id, each entry
carrying `createdAt`, `lastActivityAt`, and a `meta` object. Classify from
`meta`: `type: "schedule_cron"` means a scheduled run (its `scheduleId` says
which schedule), `threadTs` present means a channel-driven conversation,
`experimentId` present means an experiment, everything else is an on-demand
session. The file also carries a `tombstones` array of session ids the owner
deleted: leave those out of every count. Count the window's sessions and their
mix from this file with your own commands. Scheduled and interactive sessions land in the same harness store, so
this index is the only reliable way to tell them apart.

**Transcripts — locate, then sample.** Run `sh scripts/locate-history.sh` (from
this skill's directory). It reports which harness store exists on this pod and
where. Then follow the matching recipe in `references/harness-stores.md` to
list sessions in the window and to read transcripts. Read a spread of sessions
across the window and across task types. If a sampled session holds nothing
useful (trivial, aborted, empty), sample a replacement; do not pad notes from
it. If subagents are available, send the in-depth reads to parallel read-only
subagents; without them, read at most ~10 sessions yourself. Get numbers from
your own commands, not from a subagent's summary. If the locator reports an
unknown store, say so in the document's source notes and work from the platform
index, workspace, and memory alone.

**Schedules.** Call `list_schedules`. Each schedule is part of the job.

**Workspace and memory.** Read CLAUDE.md, AGENTS.md, the READMEs, and the
directory tree first. Then read your notes, memory files, daily logs, ledgers,
project notes, state files, and installed skills.

**Outputs.** Count what you produced in the window (posts, messages, items
handled). Count in the real systems you act on.

**Delivered value.** Collect evidence that the work helped the person or
business served, in two strengths. Confirmed: reactions to your work — thanks,
praise, a person says an output caught something or saved them time, output
they used or built on, repeat requests. Inferred: outcomes that served the
mission although nobody reacted — a deadline kept in view, a bug flagged before
merge, a stalled item unblocked. Judge inferred outcomes against your mission.
Present them as the outcome itself, not as a claim of credit. Also collect the
misses: output ignored, corrected, or complained about. Paraphrase. Do not
quote.

**Platform friction.** Mine for it deliberately; it gets its own section.
Collect moments where the platform itself got in the way: errors the owner hit,
work the agent could not do, repeated manual workarounds, permission or egress
walls, sessions lost or interrupted, features the owner wanted and could not
have. For each: what was the goal, what got in the way, what was the
workaround, if any. Platform friction is about the platform, not about the
model or the task being hard.

**Cost and models.** Call `get_usage_summary` with `days: 7`. Report only what
it returns: the window's total cost, the per-model split (model names are safe
to state as-is), and the session count. One or two averages at most. If the
tool reports it is unavailable, write "Cost is not measured on this install"
and move on. Never estimate cost another way, and never count tokens out of
transcripts — that is less accurate, differs per harness, and is not this
skill's job.

## Step 2: Sanitize (hard rules)

- Do not include secrets, PII (this includes the owner's identity), or verbatim
  quotes.
- Generalize, do not name: companies, products, vendors, channel/repo/ticket
  IDs, hostnames, URLs, project names, team names, and the domain data itself.
  Example: "#acme-eng-deploys" becomes "a team channel dedicated to deploy
  activity".
- Platform feature names are safe and expected: schedules, channels, the
  artifact library, connections, skills, sessions. The platform team reads
  this; naming their features is the point of the friction section. Model and
  harness names are safe too.
- The person served is a role, not a character. Describe the job. Use
  they/them. Do not use gendered pronouns. Do not give personal traits the use
  case does not need.
- Final gate: Read the finished document one more time. Ask two questions: "Can
  a sentence identify this company or a person?" and "Can an 18-year-old
  understand this?" Fix each hit. If you are not sure whether something
  identifies, treat it as if it does. Hold every section to the same plain
  English as the opening.

## Step 3: Write

Draft in a scratch location, never in the workspace. Follow the skeleton in
`references/template.md` exactly.

Keep it to one page. Only the recipe may go onto a second page. Use tables for
enumerable facts and prose for behavior. Do not use em dashes in paragraphs.
Give results only, no methodology. Back a number with a one-line source note
("counted from the platform session index"). If a section has no content, say
so in one line. Do not pad.

## Step 4: Publish to the owner and submit

1. **Owner's copy.** Title it `Agent case study — week of <YYYY-MM-DD>`, where
   the date is the Monday of the current week (UTC):
   `date -u -d "-$(( $(date -u +%u) - 1 )) days" +%F`. This is the same week the
   platform keys the edition on, so a re-run in the same week lands on the same
   title. Look for that title with `list_artifacts`, passing `search` with the
   title and `mine_only: true`. Both arguments matter: `search` keeps you from
   pulling the whole library into context, and `mine_only` keeps you off the
   artifacts of other agents this owner runs — the library is shared between
   them, they title their copies the same way, and an update is not restricted
   to the artifact you published. If your own copy exists, call
   `update_artifact` with the new content, which publishes a new version of it
   and keeps the same link; otherwise call `create_artifact` with the content,
   markdown type, and private visibility. This copy belongs to the owner and
   never leaves their library. It is also the draft they edit: while the edition
   is pending, the platform reads this copy, so any change the owner makes here
   is what gets released. If the artifact tools fail (for example, no object
   store on this install), continue — the submission below does not depend on
   it, though without a copy the owner can only release your text as written.
2. **Submit the edition.** Call `submit_case_study` with `content` (the full
   document), `window_start`, `window_end`, and the `artifact_id` from step 1
   when you have one. Send the `artifact_id` whenever step 1 produced one: it is
   what links the owner's editable draft to the edition. The edition lands as
   **pending**: only the owner can see it, and nothing reaches anyone else
   unless the owner releases it.
   Re-running in the same week replaces that week's edition — that
   is intended; the latest submission wins.
3. If `submit_case_study` is unavailable or fails, stop after step 1 and say
   so plainly: the draft exists, and nothing left the owner's boundary.

## Step 5: Report

Reply with: the window covered and the session count; the edition week and
that it is pending, visible only to the owner until they release it; a markdown
link to the owner's copy if one was created or updated, using the
`internal_link` the artifact tool returned, for example
`[Agent case study — week of 2026-08-31](platform://artifacts/<id>)`, which the
owner sees as a chip that opens the document; that they can edit that copy
before releasing and the edited version is what goes out; and one line naming
anything that was not measurable.
