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

2. **Verify the wiki remote — this gates the whole run.** The wiki must already
   have a remote you can push to; you never create it. Before any other work,
   prove the `remote` from the interview both **exists** and is **pushable**:

   ```sh
   git init -q                                                   # no-op if already a repo
   git remote add origin <remote> 2>/dev/null || git remote set-url origin <remote>
   git ls-remote origin >/dev/null                               # exists + reachable + readable
   git add -A && git commit -qm "onboard: seed" --no-verify      # need a ref to test against
   git push --dry-run origin HEAD                                # proves push access, writes nothing
   ```

   If `ls-remote` or the dry-run push fails — repo missing, unreachable, or no
   push permission — **stop immediately**. Do not write `wiki.config.json`,
   specialise `CLAUDE.md`, schedule, or ingest. Tell the user to create an empty
   repository at the `remote` and grant this agent push access, then re-run
   `onboard`. Only proceed past this step once both checks pass.

3. **Write `wiki.config.json`.** Match the shape the scripts read — each source is
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

4. **Specialise `CLAUDE.md`.** Replace the `## This wiki` placeholder with this
   wiki's purpose, domain vocabulary, the entity-vs-concept rule for this domain,
   and its contradiction policy.

5. **Schedule maintenance.** Via the `platform-outbound` MCP `create_schedule`
   tool (the only valid scheduler here — see the `platform-schedules` skill; fetch
   the tool with ToolSearch `select:mcp__platform-outbound__create_schedule` if
   its schema is not loaded). Pass the 5-field `cron`, a `name` like
   `<wiki> maintenance`, `sessionMode: "fresh"` (each tick is a clean run), and a
   `task` prompt that drives both skills, e.g. *"Maintenance run: ingest every
   source in wiki.config.json, then lint. Commit and push silently."* Record the
   returned schedule id in `wiki.config.json` so a re-run can find it.

6. **First ingest.** Run the `ingest` skill; with empty watermarks it does a
   tiered eager pass over every source.

7. **Persist.** Commit the onboarding result (`onboard: initialise <purpose>`)
   and push to the `remote` already verified in step 2.

Idempotent: a re-run updates config, the `## This wiki` section, and the existing
schedule (find it via `list_schedules`) rather than duplicating any of them.
