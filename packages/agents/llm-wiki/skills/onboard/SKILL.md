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
   have a remote you can push to; you never create it. The pushed repo is the
   `wiki/` subdirectory **only** — content (`pages/`, `index.md`, `log.md`),
   never this manual, `wiki.config.json`, or `scripts/`. First prove the `remote`
   **exists** and is **reachable**, then branch on whether it already has content:

   ```sh
   git ls-remote <remote> >/dev/null   # exists + reachable + readable (URL form, no repo needed)
   ```

   - **Empty remote (new wiki)** — seed `wiki/` and prove push access, writing
     nothing:

     ```sh
     git -C wiki init -q
     git -C wiki remote add origin <remote> 2>/dev/null || git -C wiki remote set-url origin <remote>
     git -C wiki add -A && git -C wiki commit -qm "onboard: seed" --no-verify  # need a ref to test against
     git -C wiki push --dry-run origin HEAD                                    # proves push access, writes nothing
     ```

   - **Non-empty remote (re-instantiation)** — the wiki already exists; a fresh
     agent is adopting it. Replace the image seed with a clone, then prove push
     access:

     ```sh
     rm -rf wiki && git clone --depth 1 <remote> wiki
     git -C wiki push --dry-run origin HEAD
     ```

     Then reconstruct `wiki.config.json` rather than seed it: rebuild each
     source's `watermark_sha` from the `commit:` frontmatter of its pages — the
     oldest commit pinned across that source's pages, so anything newer
     re-ingests. Config is never pushed, so it is reconstructed here, not
     restored. Skip the eager first ingest (step 6); the next scheduled run goes
     straight to delta.

   If `ls-remote` or the dry-run push fails — repo missing, unreachable, or no
   push permission — **stop immediately**. Do not write `wiki.config.json`,
   specialise `CLAUDE.md`, schedule, or ingest. Tell the user to create an empty
   repository at the `remote` and grant this agent push access, then re-run
   `onboard`. Only proceed past this step once the checks pass.

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
   Keep `taxonomy` in sync with the directories under `wiki/pages/`.

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

7. **Persist.** Commit the wiki content (`git -C wiki commit -m "onboard:
   initialise <purpose>"`) and push to the `remote` verified in step 2.
   `wiki.config.json` and the specialised `CLAUDE.md` stay on the pod's PVC —
   they are agent-owned and never pushed.

Idempotent: a re-run updates config, the `## This wiki` section, and the existing
schedule (find it via `list_schedules`) rather than duplicating any of them.
