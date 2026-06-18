---
name: onboard
description: First-run setup for an LLM-Wiki agent. Interviews the user for the wiki's purpose, source repos, page taxonomy, and maintenance cadence; writes wiki.config.json; specialises CLAUDE.md; schedules recurring ingest+lint; and runs the first ingest. Use once, when the wiki has not been onboarded yet (wiki.config.json purpose is null).
---

# onboard

Turn the generic template into a specialised wiki, then start the autonomous loop.

1. Interview (Slack / Web UI): wiki purpose; source repo(s) + ref; page taxonomy
   (default sources/entities/concepts, may rename/extend); ingest cadence.
2. Write `wiki.config.json` from the answers — sources with an empty watermark, a
   `remote`, and a cron expression (pick a minute off :00/:30 to avoid a
   fleet-wide thundering herd).
3. Specialise `CLAUDE.md`: fill the `## This wiki` section (purpose, domain
   vocabulary, entity-vs-concept rule, contradiction policy).
4. Self-schedule recurring maintenance (ingest then lint) at the chosen cadence
   using the `platform-outbound` MCP `create_schedule` tool.
5. Run the first tiered eager ingest (the `ingest` skill).
6. Initialise the git repo, set the remote, then commit + push the onboarded wiki.

Idempotent: re-running updates config and schema rather than duplicating.
