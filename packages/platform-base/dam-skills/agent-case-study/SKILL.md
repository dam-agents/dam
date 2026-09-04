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

Keep it general. An account of the use case is; an account full of this 
deployment's names is not. Anonymizing is required.

Four rules override everything else:

1. **Grounded**: Base each claim on real history. Count what a command can
   count. Label sampled numbers as approximate. If you cannot verify a number,
   say so.
2. **Sanitized**: Do not identify this company, its people, its systems, or its
   data. The document must not contain any personal or sensitive information.
   This rule musrt be followed extremely strictly with no exceptions
3. **Plain**: Write in ASD-STE100. Short sentences, one idea each, active
   voice, everyday words, no filler. Explain jargon inline at first use or avoid
   it altogether. Do not open with a glossary.
4. **Honest**: Give facts, not adjectives. Include failures and wasted spend,
   without spin. If some requirement cannot be met, state so directly.

## Ground rules for the run

- This file sits in a directory that also holds `scripts/` and `references/`.
  Resolve those paths relative to this file, wherever it lies.
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

Window: `window_start` is 7 days ago, `window_end` is today, both `YYYY-MM-DD`.

| Read this | For this |
| --- | --- |
| `$HOME/.platform/session-metadata.json` | Session count and the mix of scheduled, channel-driven, experiment, and on-demand runs. Skip tombstoned ids. All kinds share one harness store, so this index is the only reliable split. Shape and a counting command: `references/harness-stores.md`. |
| `sh scripts/locate-history.sh`, then the matching recipe in `references/harness-stores.md` | Transcripts. Sample a spread across the window and across task types; replace a useless session rather than pad from it. Unknown store: say so in the source notes and work from the index, the workspace, and memory. |
| `list_schedules` | Every schedule. Each one is part of the job. |
| The workspace | CLAUDE.md, AGENTS.md, the READMEs, the tree; then notes, memory files, logs, ledgers, state files, installed skills. |
| The systems you act on | Counts of what you produced: posts, messages, items handled. |
| `get_usage_summary` with `days: 7` | Total cost, per-model split, session count, one or two averages. Report only what it returns; if it is unavailable write "Cost is not measured on this install". Never estimate cost another way and never count tokens out of transcripts. |

Deep transcript reads go to parallel read-only subagents if you have them, else
read at most ~10 sessions. Every number comes from your own commands, never from
a subagent's summary.

Two things get their own section, so mine them deliberately:

- **Delivered value.** Confirmed: thanks, output someone used or built on,
  repeat requests. Inferred: an outcome that served the mission with nobody
  reacting — judge it against your mission, and state the outcome rather than
  claiming credit. Misses count too: output ignored, corrected, complained
  about.
- **Platform friction.** Per item: the goal, what the platform put in the way,
  the workaround or none. Include what the owner wanted and could not have. The
  subject is the platform, not the model and not a hard task.

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

1. **Owner's copy.** Title: `Agent case study — week of <YYYY-MM-DD>`, the
   Monday of this week in UTC
   (`date -u -d "-$(( $(date -u +%u) - 1 )) days" +%F`). The platform keys the
   edition on that same week, so a re-run reuses the title. Find it with
   `list_artifacts` passing both `search` (the title) and `mine_only: true`:
   `search` keeps the library out of your context, `mine_only` keeps you off the
   identically titled copies of this owner's other agents, which
   `update_artifact` will overwrite without complaint. Exists →
   `update_artifact`, which versions it behind the same link. Otherwise →
   `create_artifact`, markdown type, private. This copy is also the draft the
   owner edits: while the edition is pending the platform reads it, so their
   changes are what gets released. If the artifact tools fail, carry on — the
   owner can then only release your text as written.
2. **Edition.** `submit_case_study` with `content` (the whole document),
   `window_start`, `window_end`, and `artifact_id` whenever step 1 produced
   one, since that link is what makes the draft editable. It lands **pending**:
   owner-only until they release it. A re-run in the same week replaces that
   week's edition; latest wins.
3. If `submit_case_study` is unavailable or fails, stop and say so plainly: the
   draft exists, nothing left the owner's boundary.

## Step 5: Report

The window and session count. The edition week, pending and owner-only until
released. A markdown link to the owner's copy built from the `internal_link` the
artifact tool returned, e.g.
`[Agent case study — week of 2026-08-31](platform://artifacts/<id>)`, which the
owner sees as a chip that opens the document. That editing that copy before
releasing changes what goes out. One line naming anything not measurable.
