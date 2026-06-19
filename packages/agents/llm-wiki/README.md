# llm-wiki agent

A preconfigured Claude Code agent that maintains an **AI-curated, interlinked
markdown wiki** about one or more GitHub repositories. It implements the
LLM-Wiki pattern: distil source repos into durable, cited markdown that is
precomputed and kept current, rather than chunk-retrieved per query (RAG). The
value is the maintenance that runs when nobody is asking.

## The three layers

1. **Sources** — the GitHub repos being documented. Shallow-cloned into a
   gitignored `sources/`, read-only.
2. **Wiki** — the maintained markdown under `wiki/`: `wiki/pages/`,
   `wiki/index.md`, `wiki/log.md`. This is the product. `wiki/` is its own git
   repo and the only thing pushed to the remote, so the remote stays a pure
   content database that outlives the pod.
3. **Schema & tooling** — `CLAUDE.md` (the operating manual), `wiki.config.json`
   (per-instance configuration), and `scripts/` (helpers). Agent-owned: they live
   on the pod's PVC beside `wiki/`, never inside it. Onboarding specialises
   `CLAUDE.md` and writes `wiki.config.json` for the domain.

## How the image is built

The image is `FROM platform-claude-code` — it reuses the Claude Code harness
wholesale (the `claude` binary, model gateway, pod service, `harness-chat` /
`harness-terminal`, and the `.claude/skills -> .agents/skills` symlink). On top
it adds two overlays:

- `skills/` → `/app/working-dir/.agents/skills/` — the four wiki workflow skills
  (`onboard`, `ingest`, `query`, `lint`), baked at the canonical skill path and
  surfaced to Claude Code through the inherited symlink.
- `workspace/` → `/app/working-dir/work/` — the agent workspace seed:
  `CLAUDE.md`, `wiki.config.json`, `scripts/`, and the `wiki/` content-repo seed
  (`wiki/index.md`, `wiki/log.md`, `wiki/pages/`). It lands in `work/` because
  that is Claude's working directory in the pod.

Build locally with `mise run agents:llm-wiki:image` (depends on the claude-code
image). CI builds it after claude-code rather than in the flat agent matrix,
because it bases on that image rather than `platform-base`.

## How DAM runs it

The controller mounts a per-agent PVC at `$HOME` (`/home/agent`). On first boot
the template `init` script seeds the image's `/app/working-dir` into `$HOME` and
creates `$HOME/work` (Claude's working directory), so the `workspace/` seed lands
on persistent storage with the live wiki repo at `$HOME/work/wiki`. The PVC
survives hibernation. Across agent deletion only the `wiki/` content survives —
via its git remote configured at onboarding; a fresh agent clones it and
reconstructs `wiki.config.json` (source list, watermarks) from page provenance.

The agent is fully autonomous after onboarding:

- **onboard** (manual, once) — interview, write config, specialise `CLAUDE.md`,
  self-schedule maintenance, run the first ingest.
- **ingest + lint** (scheduled) — delta-ingest new commits, then lint; commit
  and push silently.
- **query** (Slack / Web UI) — answer from the wiki with citations.

Maintenance is scheduled through the `platform-outbound` MCP `create_schedule`
tool — the only valid scheduler inside a Platform pod.

## Instantiating

Registered as a `preconfigured` agent template (`agentTemplates` in the Helm
chart), so it appears in the Add-Agent wizard. Create an agent from the
`llm-wiki` template, then run `onboard` in the first session to point it at the
repos you want documented.
