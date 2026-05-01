# ADR-030: Skills — connectable sources and install

**Date:** 2026-04-17
**Amended:** 2026-04-29 — substrate moved from ConfigMap to Postgres; transport from REST to tRPC; Phase 0 scope expanded with publish, private sources, MCP tools, standalone skills, and drift detection. Implementation: PR #257.
**Status:** Accepted
**Owner:** @PetrBulanek

## Context

One user's breakthrough workflow never propagates. New users face a blank slate. [kagenti/humr-claw#5](https://github.com/kagenti/humr-claw/issues/5) asks for a shared skills surface in Humr, modeled on [Ramp's Glass](https://x.com/sebgoddijn/status/2042285915435937816).

Prior decisions:

- [ADR-011](011-skills-claude-marketplace.md) — standardize on Claude's plugin marketplace (single-harness assumption).
- DRAFT-skills-harness-native (closed) — platform does nothing; each harness brings its own registry.
- [ADR-023](023-harness-agnostic-base-image.md) — narrow harness contract; "skill registries are the harness's business."
- [ADR-005](005-credential-gateway.md) — OneCLI as the credentials gateway.
- [ADR-024](024-connector-declared-envs.md) — connector-declared envs and per-agent overrides.

Since then: [agentskills.io](https://agentskills.io) is an open cross-harness standard (38+ adopters); Pi ships alongside Claude Code; public skill marketplaces exist (skills.sh, ClawHub, LobeHub, Anthropic's repo, OpenAI's catalog).

This refines ADR-023. Humr doesn't define skill *format* or *interpretation* — agentskills.io and the harness do. It owns skill *transport* — same category as credentials (ADR-005/010), env (ADR-024), and workspace seeding (ADR-001).

**We do not build our own marketplace.** Skill sources are external — public marketplaces, vendor catalogs, internal git repos. Humr connects to them like it connects to MCP servers. The differentiating Humr value (transport, isolation, policy) does not require hosting the catalog.

## Decision

### 1. Skill source as a primitive

A skill source is a connection to an external git repository, addressable by id. Sister to OneCLI credential connectors (ADR-024) and MCP connections. Three kinds, merged into a single list at read time and badged in the UI:

- **User source** — a row in the Postgres `skill_sources` table, owner-scoped. Created and deleted by the user via tRPC.
- **System source** — a Helm-declared platform-wide entry from `skills.skillSources` ([`deploy/helm/humr/values.yaml`](../../deploy/helm/humr/values.yaml)). Rendered into the api-server pod as the `SKILL_SOURCES_SEED` env (Zod-validated, slug ids), loaded into config at boot, **never persisted to Postgres**. Marked `system: true`, protected from deletion. Badged "Platform".
- **Template source** — declared on a template's `spec.skillSources`. Surfaced read-only on every instance derived from that template. Badged "Agent".

Listing dedupes on `gitUrl` with first-wins precedence: user → template → system. A user creating a custom source for the same URL shadows the system entry; deleting the user row exposes the system entry again.

Source URL kinds:

- **Public GitHub** — scanned anonymously by the api-server via `archive/HEAD.tar.gz`. No instance required.
- **Private GitHub** — scanned via agent-runtime, credentials supplied by OneCLI MITM (see §3).
- **Other git hosts** — shallow `git clone` from agent-runtime; `gh auth setup-git` at boot routes credential prompts through OneCLI.

### 2. Install

- `instance_skills` Postgres table (key `(instanceId, source, name)`) records what's installed on which instance with which `version` (commit SHA) and `contentHash` (SHA-256 over the skill directory). The on-disk directory at the configured Skill Paths is the **source of truth**; the row is a declarative record that self-heals on each `state` query (ghost rows whose directories were deleted out-of-band are dropped and the cleanup persisted).
- `AgentSpec.skillPaths: []` (copied from `TemplateSpec.skillPaths` at agent creation) — where the harness reads skills from. Default `["/home/agent/.agents/skills/"]` (the cross-harness default). Claude-Code-derived templates override to `["/home/agent/.claude/skills/"]`.
- **Agent-runtime** exposes a Bearer-authenticated tRPC surface on the harness port — `skills.{install,uninstall,publish,scan,listLocal}`. The api-server is the only caller. On install, agent-runtime fetches the source at the requested commit (REST tarball for GitHub, shallow clone for others), resolves the skill directory inside the fetch (`skills/<name>/` then top-level `<name>/`), copies it into every configured Skill Path, and returns the `contentHash`.
- Skills land on the per-instance PVC and persist across restart naturally — no init container, no pod roll.
- UI: a **Skills** section in ADR-024's Configure dialog with install checkboxes drawn from connected sources, drift badges (per-skill `contentHash` mismatch), and a Standalone group for locally-authored skills.

Agent templates own harness-specific quirks (`skillPaths`); controller stays harness-agnostic per [ADR-023](023-harness-agnostic-base-image.md). The controller is **not** involved in skill sync — it remains a ConfigMap reconciler only.

### 3. Publish

- **Git sources (GitHub only in v1)** — invisible-git. User authors a skill on the pod (Files panel), clicks *publish*, Humr opens a PR on the connected repo. Git-host PR review is the gate. Non-technical users never see git.
- **Mechanism: REST, not `git push`.** agent-runtime drives the full GitHub REST flow (blobs → tree → commit → branch → PR) from inside the pod. Branch naming: `humr/publish-<name>-<timestamp>`. Author: `Humr <humr-publish@users.noreply.github.com>`. Per-file and per-skill size caps applied before upload.
- **Credentials via OneCLI MITM (ADR-005).** agent-runtime never holds a real GitHub token. Three pieces:
  1. Controller sets `GH_TOKEN=humr:sentinel` as a platform-default env on every agent pod.
  2. Pod's `HTTPS_PROXY` + cluster MITM CA route every outbound request through OneCLI's gateway.
  3. agent-runtime sends `Authorization: Bearer humr:sentinel` on every GitHub API call; OneCLI swaps for the owner's OAuth token on the wire.
- **Publish records.** `instance_skill_publishes` table logs successful publishes (skillName, sourceId, prUrl, plus denormalized source name/gitUrl so the row stays usable after the source is renamed or deleted). Drives the "Published" badge on Standalone rows; replaces the name-match heuristic.
- **Public marketplaces** — out-of-band. Users publish through each marketplace's own flow. Humr does not intermediate.

### 4. Agent-callable installs (MCP)

The per-instance MCP endpoint registers five tools so the harness can install skills via chat (not only the human via the UI): `list_skill_sources`, `list_skills_in_source`, `install_skill`, `uninstall_skill`, `publish_skill`. `instanceId` is bound by the verified MCP session token, not tool input — agents cannot spoof which instance they're acting on.

`add_skill_source` is **deliberately excluded** so an agent under prompt injection cannot introduce arbitrary git URLs. Adding sources stays user-only via the UI / tRPC.

### 5. Discovery (sort + filter)

No separate recommender. Skills section ranks the catalogue by **source-provided signals** (install counts, stars, last-updated), surfaced as-is. Per-source headers are collapsible (curated rows default collapsed). Filter chips (source, frontmatter tag) and text search are deferred.

A real recommender (Sensei/Glass pattern) needs role, usage telemetry, and cross-instance data — none collected today. See *Later phases*.

## What shipped (PR #257)

**Persistence ([ADR-034 folded in](../architecture/persistence.md)).** Skills are entirely an Application State subsystem on Postgres:

| Table | Key | Owner |
|---|---|---|
| `skill_sources` | `(id)`, unique on `(owner, gitUrl)` | per-user |
| `instance_skills` | `(instanceId, source, name)` | per-instance |
| `instance_skill_publishes` | `(id)`, indexed by `instanceId` | per-instance |

System sources come from `SKILL_SOURCES_SEED` env; template sources from `template.spec.skillSources`. Neither persists. PVC reclamation handles file-side cleanup on instance deletion; the Skills cleanup saga (subscribes to `InstanceDeleted`) handles the row-side. User-owned sources outlive any single instance.

**Schema additions:**
- `humr.ai/type=skill-source` is **not** used. Sources moved to Postgres before merge.
- `TemplateSpec.skillPaths: string[]` and `AgentSpec.skillPaths: string[]`. Default `["/home/agent/.agents/skills/"]`. Claude-Code-based templates (`example-agent`, `google-workspace`, `code-guardian`) override to `["/home/agent/.claude/skills/"]`. `pi-agent` uses `["/home/agent/.pi/agent/skills/"]`. Resolution at install time: `agent.spec.skillPaths` → `template.spec.skillPaths` → cross-harness default.
- `TemplateSpec.skillSources: [{name, gitUrl}]` for template-bound sources.
- `InstanceSpec.skills` is **not** added. (Earlier draft had it; replaced by `instance_skills` table.)

**Agent-runtime:** tRPC `skills` router on the existing protected harness port — `install`, `uninstall`, `publish`, `scan`, `listLocal`. Bearer auth uses the per-instance OneCLI access token (same token as harness + egress). Layered per tseng: domain (skill-name, frontmatter, branch-timestamp) / infrastructure (github-rest, git-protocol, local-skill-repository) / services (install, scan, publish).

**API server:** tRPC `skills` router — `sources.{list,create,delete,refresh}`, `listSkills` (5-min per-`gitUrl` scan cache, invalidated on `sources.refresh` and after every successful publish to that source), `listLocal`, `state`, `install`, `uninstall`, `publish`. Public GitHub catalogs scanned by the `public-archive-scanner` directly from the api-server (no credentials, works without a running instance); private + non-GitHub fall through to agent-runtime over the harness port.

**MCP tools:** five tools as in §4, registered on `mcp-endpoint` and scoped by the verified session.

**UI:** Skills section in the per-instance Configuration panel — Standalone group (with `Published` badge once upstream catalog picks them up), source list with refresh / add / remove, install checkboxes, drift badges with compare-view link, publish dialog with "View PR" and structured-error CTAs (Connect GitHub / grant agent access / add repo to OAuth App). Polls `platform.instances.get` every 5s so agent-initiated installs surface without manual refresh.

**Helm:** `skillPaths` on Claude-Code-based templates; opt-in `skills.skillSources` (platform-wide) and per-template `<templateKey>.skillSources`, both rendered into `SKILL_SOURCES_SEED`.

**Out of scope (still):** install-while-hibernated (button disabled when instance is stopped), hot-reload into a running session (harness rescans on next session start), direct upload, public-marketplace API integrations, real recommender, per-skill NetworkPolicy.

**Success:** user ticks a skill → starts a new session → agent invokes the skill. Verified end-to-end including private-source install and publish via OneCLI MITM.

## Later phases (sketch)

- Public marketplace API source kinds (skills.sh, ClawHub, etc.).
- Direct upload as a source kind.
- Sort + filter chips (source metrics, frontmatter match) and text search.
- Real recommender once role signals and install telemetry exist.
- Per-skill NetworkPolicy from declared permission manifests.
- Publish to non-GitHub git hosts.

## Non-goals

- Humr-owned catalog, publishing review, or public-facing marketplace.
- Humr-invented ratings or reviews (surface source-provided ones as-is).
- Cross-install usage telemetry.
- Exhaustive harness support in v1.

## Alternatives Considered

**Build a marketplace.** Duplicates skills.sh, ClawHub, LobeHub, Anthropic, OpenAI. No differentiated value. Ramp built theirs for company-private skills — covered here by connecting a private git repo. Rejected.

**Rule-based recommender now.** Needs role, telemetry, user pool — none exist today. With only agent-template and connected-MCP signals, output is tautological or empty. Sort + filter covers v1 discovery. Deferred.

**MCP-only install (agent tool-call) without UI gating.** Breaks on (1) filesystem-load semantics — skills load at startup, not at runtime; (2) prompt injection drives silent installs. We compromised: MCP tools exist but `add_skill_source` is excluded so agents can only install from sources the user already trusts. Source-creation stays user-only.

**Reaffirm ADR-011 (Claude marketplace only).** Single-harness assumption no longer holds; ADR-023 commits to harness-agnostic agents. Rejected.

**ConfigMap substrate for sources/installed/publishes** (the original draft of this ADR). Would have made the controller a write path for skill state and forced reconcile loops for what is fundamentally per-user catalog data. Postgres is the right substrate per [persistence.md](../architecture/persistence.md): user-scoped Application State with no controller involvement. Switched before merge.

**`git push` for publish.** Requires holding a credential in the pod or an SSH-key dance. The OneCLI MITM pattern (ADR-005) already solves the credential problem for HTTP, and the GitHub REST API supports the full PR flow without a working tree. REST-only.

## Consequences

- Supersedes [ADR-011](011-skills-claude-marketplace.md); closes the harness-native draft.
- New schema: `skill_sources`, `instance_skills`, `instance_skill_publishes` Postgres tables; `TemplateSpec.skillPaths`, `AgentSpec.skillPaths`, `TemplateSpec.skillSources`. No new ConfigMap kinds.
- Agent-runtime gains a tRPC `skills` router on the harness port; the api-server is the sole caller and authenticates with the per-instance OneCLI access token (same token reused on three surfaces — egress, harness, tRPC).
- Publish flow depends on OneCLI MITM ([ADR-005](005-credential-gateway.md)) and the platform-default `GH_TOKEN=humr:sentinel` env ([ADR-024](024-connector-declared-envs.md)). agent-runtime never holds a real GitHub token; a compromised pod cannot exfiltrate it.
- UI gains a Skills section in the Configure dialog (per-instance) and a connect-source flow analogous to connecting an MCP server.
- The harness MCP endpoint exposes four install/discovery tools and one publish tool; `add_skill_source` is intentionally absent to block prompt-injection URL drops.
- No new service or Deployment. Skill-source fetch and Skills section logic live in the existing api-server; pod-side logic in the existing agent-runtime.
- Supply-chain responsibility for skill *content* stays with the source. Optional per-skill NetworkPolicy (from declared permission manifests) can layer on later.
- See [docs/architecture/skills.md](../architecture/skills.md) for the as-built diagram, flows, and invariants.
