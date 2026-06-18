---
name: onboard
description: First-run setup for an LLM-Wiki agent. Interviews the user for the wiki's purpose, source repos, page taxonomy, and maintenance cadence; writes wiki.config.json; specialises CLAUDE.md; schedules recurring ingest+lint; and runs the first ingest. Use once, when the wiki has not been onboarded yet (wiki.config.json purpose is null).
---

# onboard

Turn the generic template into a specialised wiki, then start the autonomous loop.
The only interactive workflow; everything after runs on the schedule.

1. **Interview** (Slack / Web UI): wiki purpose; source repo(s) as `org/repo` + an
   optional ref; page taxonomy (default `sources`/`entities`/`concepts`, may
   rename/extend); maintenance cadence; the git `remote` to push the wiki to.

2. **Write `wiki.config.json`.** Match the shape the scripts read — each source is
   an object with `repo` (`org/repo`), an optional `ref`, and `watermark_sha: ""`
   (empty = never ingested; `watermark.mjs` and `ingest` key off these names):

   ```json
   {
     "purpose": "<one line>",
     "taxonomy": ["sources", "entities", "concepts"],
     "sources": [{ "repo": "org/repo", "ref": "main", "watermark_sha": "" }],
     "remote": "git@github.com:org/wiki.git",
     "cron": "17 6 * * *"
   }
   ```

   Pick a cron **minute off :00 and :30** to avoid a fleet-wide thundering herd.
   Keep `taxonomy` in sync with the directories under `pages/`.

3. **Specialise `CLAUDE.md`.** Replace the `## This wiki` placeholder with this
   wiki's purpose, domain vocabulary, the entity-vs-concept rule for this domain,
   and its contradiction policy.

4. **Schedule maintenance.** Via the `platform-outbound` MCP `create_schedule`
   tool (the only valid scheduler here — see the `platform-schedules` skill; fetch
   the tool with ToolSearch `select:mcp__platform-outbound__create_schedule` if
   its schema is not loaded). Pass the 5-field `cron`, a `name` like
   `<wiki> maintenance`, `sessionMode: "fresh"` (each tick is a clean run), and a
   `task` prompt that drives both skills, e.g. *"Maintenance run: ingest every
   source in wiki.config.json, then lint. Commit and push silently."* Record the
   returned schedule id in `wiki.config.json` so a re-run can find it.

5. **First ingest.** Run the `ingest` skill; with empty watermarks it does a
   tiered eager pass over every source.

6. **Persist.** `git init` if the repo is not already one, set the configured
   `remote`, then commit (`onboard: initialise <purpose>`) and push.

Idempotent: a re-run updates config, the `## This wiki` section, and the existing
schedule (find it via `list_schedules`) rather than duplicating any of them.
