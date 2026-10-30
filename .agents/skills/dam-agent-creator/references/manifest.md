# The agent manifest

Read in Phase 2 (the **Public interface** item of the proposal) and Phase 3–4, and when an existing agent must get a manifest.

Every generated agent publishes one JSON card that describes its outer interface: where it listens, what starts its work, what it reads and writes, what it publishes and which packages it offers.
People read it to learn how to use the agent; other agents read it to address it without knowing its definition.
DAM has no such card of its own: the public agent page shows a name and an owner, and an invocation only spawns a new agent.

The shape takes from the A2A AgentCard only what fits an agent with no RPC endpoint (identity, skills with descriptions) and adds what such an agent needs: surfaces, triggers, contracts, handoffs by role, public pages, packages, trust rules.
The agent-facing procedure is `templates/docs/manifest.md.template`; the shape is `templates/manifest.schema.json`; the check is `templates/manifest-check.sh.template`.

## Design rules

- **The agent writes it, at runtime.** Neither this skill nor a script generates the card: the agent knows what is true now (its channels, its public pages, the models that ran) and chooses its sources. The script only checks.
- **Everything public, nothing private.** An entry belongs in the card when a person or an agent outside the instance sees it, uses it or relies on it. Config key names, `work/` paths, people, ids and private repositories stay out; `manifest-check.sh` scans for them with the design's `PUBLIC_KEYS`.
- **Plain words over schemas.** A contract is `where`, `format`, `meaning` in sentences a reader agent understands; the card holds no nested JSON Schema.
- **Ids are keys.** Triggers, skills and contracts are maps keyed by kebab-case ids; every list refers to them by key, and the check resolves every reference.
- **Handoffs name roles, never agents.** `code-reviewer`, `implementer`, `qa-tester`, `quality-advisor`, `reporter`. A role list that grows is a schema change in this skill.
- **Freshness has two clocks.** `source.version` is the digest of the interface and changes only when a reader must re-read; `runtime` (harness, observed models, schedule overrides) changes more often and stays outside the digest.
- **Peers are local.** Each agent keeps its own `work/PEERS.md` with the manifest links the operator gives it; nothing new lives in DAM.

## What the proposal decides

- The roles the agent serves and its handoffs (which trigger another role uses to pass it work, which of its contracts is work for another role).
- `PUBLIC_KEYS`: the config keys whose values the card may show.
- The packages it offers (skills in its definition repo that others can install).
- Whether `agent_manifest` defaults to `dam` (publish) or `off`. Publishing is public by nature; it is asked at onboarding like every other publish.

## Existing agents (one-time)

An agent created before this skill had the manifest gets it in two steps, both in its direct session, both started by its operator.

**1. One card now.** The operator pastes this message into the agent's direct session:

> Write your agent manifest once, following the DAM agent-creator skill.
> Download into a new directory under `$TMPDIR`, not into your definition:
> `https://raw.githubusercontent.com/dam-agents/dam/main/.agents/skills/dam-agent-creator/templates/docs/manifest.md.template` as `manifest.md`,
> `https://raw.githubusercontent.com/dam-agents/dam/main/.agents/skills/dam-agent-creator/templates/manifest.schema.json` as `manifest.schema.json`,
> `https://raw.githubusercontent.com/dam-agents/dam/main/.agents/skills/dam-agent-creator/templates/manifest-check.sh.template` as `manifest-check.sh`.
> Read `manifest.md` and follow **What goes in**, **What stays out**, **Sections** and **Sources** for your own definition, config and platform.
> Before you write, show me the config keys whose values you will show in public and wait for my answer.
> Write the card to `work/manifest.json`, then run, with `MANIFEST_SCHEMA=<dir>/manifest.schema.json` and `MANIFEST_PUBLIC_KEYS="<the keys I approved>"`:
> `bash <dir>/manifest-check.sh stamp work/manifest.json` and `bash <dir>/manifest-check.sh publish work/manifest.json`, until it prints PASS.
> Show me the card. When I agree, publish it as a public DAM artifact per **Write, check, publish** step 4, and give me the link.
> Do not change your definition, config or schedules in this step.

The card is then a snapshot: it does not follow later changes.

**2. Keep it current.** The agent adopts the procedure into its own definition through its usual definition-change path (its self-modification rules, a pull request on its definition repo): copy the three files to `docs/manifest.md`, `docs/manifest.schema.json` and `scripts/manifest-check.sh` with its `PUBLIC_KEYS`, add the audit task, the `agent_manifest` config key and `work/PEERS.md`, and an upgrade step in its changelog that writes the first card.
After that, its weekly audit rewrites and republishes the card, and step 1 is not needed again.
