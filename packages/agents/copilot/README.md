# GitHub Copilot Agent

Platform agent running [GitHub Copilot CLI](https://github.com/github/copilot-cli), which is an ACP agent itself (`copilot --acp`).

The harness ships in the default image every harness Template boots, built by `//packages/agents:oci` from the shared base in [`packages/agents/base`](../base/) (see [agent images](../../../docs/architecture/agent-images.md)): its tool, declared in [`image.toml`](image.toml), is baked into the default image's harness tools layer, and its files live at their image paths under [`rootfs/`](rootfs/).

## Stack

| Component | Package           | Purpose                                                                         |
| --------- | ----------------- | ------------------------------------------------------------------------------- |
| CLI       | `@github/copilot` | ACP agent for chat sessions (`--acp --stdio`) and the TUI for terminal sessions |

The npm package is a loader that runs the native binary of its platform package (`@github/copilot-linux-x64`, `-arm64`, and the musl variants), all pinned in the image lockfile.
On its first start the binary unpacks its app, about 200 MB, into `$XDG_CACHE_HOME/copilot`, which would land in every agent's persistent home.
So the tool's `postinstall` in [`image.toml`](image.toml) unpacks it once at build time into the package's `dist/` in the harness tools layer, and [`copilot-router.sh`](rootfs/usr/local/lib/copilot-router.sh) names that directory in `COPILOT_CLI_DIST_DIR`.

## Models: BYOK through the Model Router

Copilot runs on the platform's providers, never on a GitHub Copilot subscription.
[`copilot-router.sh`](rootfs/usr/local/lib/copilot-router.sh) sets Copilot's bring-your-own-key provider to the [Model Router](../../../docs/architecture/harness-config.md#the-model-router) on the pod's loopback:

- `COPILOT_PROVIDER_BASE_URL` names the router, `COPILOT_PROVIDER_TYPE=openai` and `COPILOT_PROVIDER_WIRE_API=completions` make Copilot speak Chat Completions.
  Copilot speaks one wire API per process, and Chat Completions reaches the most providers: the LiteLLM proxies, OpenAI and the platform provider.
  The Anthropic key speaks Messages only, so Copilot cannot run on it.
- `COPILOT_PROVIDER_API_KEY` gets the router's placeholder; the router drops it and owns the upstream credential.
- `COPILOT_PROVIDER_HEADERS` sends `X-Platform-Harness: copilot`, and in a terminal also the platform's session id.

With a BYOK provider set, Copilot needs no GitHub login.

### Model selection

The model is a per-turn choice.
The platform sends it over ACP as the `model` session config option before each prompt.
Copilot does not list that option in `session/new`, but it accepts it.

Copilot refuses to start without a model, so the runtime puts the first model of the default provider into `COPILOT_MODEL` (`defaultModelEnv` in the [manifest](rootfs/app/runtime-manifest.yaml)).
With no provider granted, the scripts name a model that does not exist, and the router refuses the first call with its reason.

Copilot's calls carry no session id, so the router routes a chat call by its qualified model name alone.
While exactly one Copilot session runs a turn, the router books the call, and its spend, to that session (`sessionFromRunningTurn`); while several run at once, the call counts as no Session.

## Approvals and modes

`COPILOT_ALLOW_ALL=true` lets Copilot run every tool without asking and trusts the working directory.
The pod is the boundary, and nobody answers a permission prompt on a schedule or a channel turn.

A session can pick Copilot's mode: Agent, Plan or Autopilot.
A session that picks none starts in Autopilot: an ACP session ignores `--autopilot` and starts in Agent, so the runtime sends the catalog's start mode (`deriveStartMode` in the [manifest](rootfs/app/runtime-manifest.yaml)), and `harness-terminal` passes `--autopilot`.
The Config panel stores the agent's default under `platform.mode` in `~/.copilot/settings.json`, a key Copilot itself ignores.

A session can also pick the reasoning effort.
Copilot takes it as the `reasoning_effort` config option, which it does not list in `session/new`, and sends the value to the provider as it is; with none picked, it sends `medium`.

## Files the platform writes

- **MCP servers.** The runtime writes `~/.copilot/mcp-config.json`.
  An entry with no `tools` list exposes every tool of its server.
- **Skills.** Copilot loads skills from `~/.agents/skills`, where the platform installs them.

## Platform instructions

`COPILOT_CUSTOM_INSTRUCTIONS_DIRS=/etc/copilot` makes Copilot load every `instructions/*.instructions.md` there.
[`platform.instructions.md`](rootfs/etc/copilot/instructions/platform.instructions.md) is a link to `/etc/AGENTS.md`, so each Copilot process gets the instructions of the image it runs in.
A user's `~/.copilot/copilot-instructions.md` and `work/AGENTS.md` still load beside them.

The agent's own instructions are `~/AGENTS.md` ([agent instructions](../../../docs/architecture/agent-images.md#agent-instructions)).
Copilot walks up from the work directory for `AGENTS.md`, but it stops at a git root, so it misses `~/AGENTS.md` when the work directory is a repository of its own.
`COPILOT_CUSTOM_INSTRUCTIONS_DIRS` does not help there: Copilot reads only `instructions/*.instructions.md` in those directories, not an `AGENTS.md`.
So both launch scripts source [`copilot-agents-md.sh`](rootfs/usr/local/lib/copilot-agents-md.sh), which links `~/.copilot/instructions/agent.instructions.md` to `~/AGENTS.md` only while the walk misses it, also before the file exists.
Copilot does not drop a file it reaches both ways, so in any other layout the script removes its link.
The runtime starts the chat process when the agent starts, so a work directory that becomes a repository later gets the link at the agent's next start.
A regular file the owner put at that path is kept.

## Startup network calls

`COPILOT_OFFLINE=true` turns off GitHub authentication, telemetry, the web tools, the GitHub MCP server and the update check, so a Copilot start asks for no egress approval.
`COPILOT_AUTO_UPDATE=false` keeps the image's pinned CLI.
The agent still reaches the web with its shell and the browser.

## Terminal sessions

`harness-terminal` starts the TUI with `--session-id` set to the platform's session id.
Copilot resumes the conversation with that id, or starts a new one under it, so a terminal session needs no pin file.

## Telemetry

Copilot has no export rail.
The Model Router records every call, which is the source of [spend](../../../docs/architecture/metrics.md).
