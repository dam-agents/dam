---
name: agent-case-study
description: >
  Produce this agent's case study - a sanitized, plain-English, one-page account
  of the use case it serves, what it delivered, what it cost, and where the
  platform got in the way - then submit it to the platform as a pending edition
  only the owner can see. Use only when a scheduled task or the owner explicitly
  asks for a case study ("case study", "share your experience", "document how
  you work", "summarize what you do and what it's worth"). Never start one on
  your own initiative.
---

You write one document: a plain-English, one-page case study of this agent. It
covers the use case the agent serves, what it delivered, what it cost, and where
the platform got in the way. You then submit it to the platform, where only the
owner can see it until they release it.

Keep it general. An account of the use case is useful; an account full of this
deployment's names is not. Anonymizing is required.

## Rules

Five rules override everything else.

1. **Grounded**: Every claim comes from real history. Count what a command can
   count; label sampled numbers approximate.
2. **Sanitized**: Do not identify this company, its people, its systems, or its
   data. No personal or sensitive information, no exceptions.
3. **Plain**: Write in ASD-STE100: short sentences, one idea each, active
   voice, everyday words, no filler. Explain jargon inline at first use or
   avoid it; never open with a glossary.
4. **Honest**: Facts, not adjectives. Include failures and wasted spend,
   without spin. Say plainly what you cannot verify, meet, or measure.
5. **Unattended**: Never ask a question mid-run. Thin evidence makes a thin
   document, not a question.

Two mechanics, for the whole run:

- **Paths.** This file sits beside `scripts/` and `references/`. Resolve those
  relative to this file, wherever it lies.
- **Tools.** `submit_case_study`, `get_usage_summary`, `list_schedules`,
  `list_artifacts`, `create_artifact`, and `update_artifact` live on the
  `platform-outbound` MCP server. If a schema is not loaded, fetch it with
  ToolSearch, e.g.
  `select:mcp__platform-outbound__submit_case_study,mcp__platform-outbound__get_usage_summary`.

## Step 1: Mine your real history

Set the window first: `window_start` is 7 days ago, `window_end` is today, both
`YYYY-MM-DD`. Then work these sources in order.

1. **Session index.** `$HOME/.platform/session-metadata.json`, the platform's
   metadata on every session. Count the window's sessions and their mix -
   scheduled, channel-driven, experiment, on-demand - skipping tombstoned ids.
   Only the index tells these kinds apart; the harness store mixes them. Shape
   and counting command: `references/harness-stores.md`.
2. **Session content.** The transcripts: what was asked, what you did, how it
   landed. `sh scripts/locate-history.sh` finds this pod's store; the store's
   recipe in `references/harness-stores.md` reads it. Skim every opening
   request to map what you are used for. Deep-read a spread across window and
   task types - parallel read-only subagents if available, else at most ~10
   sessions yourself; numbers always from your own commands, never a
   subagent's summary. Replace useless samples. Unknown store: note it, use
   the other sources.
3. **Schedules.** Call `list_schedules`. Each schedule is part of the job.
4. **Workspace.** Your standing setup and accumulated state - the mission,
   rules, and seed files the Setup recipe section reconstructs. Read CLAUDE.md,
   AGENTS.md, the READMEs, and the tree; then notes, memory files, logs,
   ledgers, state files, installed skills.
5. **Outputs.** Count what you produced in the window - posts, messages, items
   handled - by querying the systems themselves over the connections you
   already use to act on them. Transcripts and schedules name those systems.
6. **Cost.** Call `get_usage_summary` with `days: 7` and report only what it
   returns: total cost, per-model split, session count, one or two averages.
   If unavailable, write "Cost is not measured on this install". Never
   estimate cost another way; never count tokens from transcripts.

While mining, collect for the document's two dedicated sections:

- **Delivered value.** Confirmed: thanks, output someone used or built on,
  repeat requests. Inferred: outcomes nobody reacted to - judge them against
  your mission and state the outcome, not a claim of credit. Misses count too:
  output ignored, corrected, complained about.
- **Platform friction.** Per item: the goal, what the platform put in the way,
  the workaround or none. Include what the owner wanted and could not have. The
  subject is the platform, not the model and not a hard task.

If the window holds no sessions at all (no platform index, nothing in the
harness store), reply that there is nothing to summarize and stop. Submit
nothing. A quiet week is normal; never pad an edition to fill one.

## Step 2: Sanitize

- No secrets, no PII (the owner's identity included), no verbatim quotes.
- Generalize instead of naming: companies, products, vendors, channel, repo and
  ticket ids, hostnames, URLs, project and team names, the domain data itself.
  `#acme-eng-deploys` becomes "a team channel dedicated to deploy activity".
- Safe and expected: platform feature names (schedules, channels, the artifact
  library, connections, skills, sessions), model names, harness names. Naming
  the platform's own features is the point of the friction section.
- The person served is a role, not a character. Describe the job, use they/them,
  and give no traits the use case does not need.
- Final gate: reread the document and ask whether any sentence can identify this
  company or a person, and whether an 18-year-old understands it. Fix every hit.
  Unsure counts as identifying.

## Step 3: Write

Draft in a scratch location, never the workspace. Follow
`references/template.md` exactly. One page; only the recipe may run onto a
second. Tables for enumerable facts, prose for behavior. Results only, no
methodology. A one-line source note behind each number ("counted from the
platform session index"). An empty section says so in one line. No em dashes in
paragraphs. No padding.

## Step 4: Publish and submit

1. Title the document `Agent case study - week of <YYYY-MM-DD>`, the Monday of
   this week in UTC: `date -u -d "-$(( $(date -u +%u) - 1 )) days" +%F`.
2. Look it up with `list_artifacts`, passing both `search` (the title) and
   `mine_only: true`. Found: `update_artifact` with the new content. Not
   found: `create_artifact`, markdown type, private visibility. If the
   artifact tools fail, continue.
3. Call `submit_case_study` with `content` (the full document),
   `window_start`, `window_end`, and the `artifact_id` from step 2 if you have
   one.
4. If `submit_case_study` is unavailable or fails, stop and say so plainly:
   the draft exists, nothing left the owner's boundary.

## Step 5: Reply

The final reply is all the owner sees of the run; everything else belongs in
the document. State success or failure, link the owner's copy as
`[<title>](<internal_link>)` - the owner sees a chip that opens it - and say
that they can edit that copy before releasing; until released, the edition
stays pending and visible only to them.
