# Hermes Agent

Platform agent running [Nous Research Hermes Agent](https://github.com/NousResearch/hermes-agent), which is an ACP agent itself (`hermes acp`).

The harness ships in the default image every harness Template boots, built by `//packages/agents:oci` from the shared base in [`packages/agents/base`](../base/) (see [agent images](../../../docs/architecture/agent-images.md)).
Its tool, declared in [`image.toml`](image.toml), is a pipx tool with the `acp` and `mcp` extras, and its files live at their image paths under [`rootfs/`](rootfs/).
Pickers offer it only to owners who turn on the Hermes [experimental feature](../../../docs/architecture/features.md).

## Stack

| Component | Package                      | Purpose                                                       |
| --------- | ---------------------------- | ------------------------------------------------------------- |
| Agent     | `hermes-agent[acp,mcp]`      | ACP agent for chat sessions and the TUI for terminal sessions |
| Launcher  | `hermes_platform.py` (image) | Writes the platform's config keys and fixes the session model |

Hermes keeps its state under `~/.hermes`: `config.yaml`, `state.db` (sessions), `memories/`, `skills/` and `SOUL.md`.
All of it is on the agent's home volume, so memory and the skills Hermes writes for itself survive restarts.

## The launcher

Both launch scripts run [`hermes_platform.py`](rootfs/usr/local/share/hermes-platform/hermes_platform.py) on the Python of Hermes's own venv.
On every start it writes these keys into `~/.hermes/config.yaml` and keeps every other key the owner set:

- `model.provider: platform` and `providers.platform`: one custom OpenAI-compatible provider at the [Model Router](../../../docs/architecture/harness-config.md#the-model-router) over Chat Completions, with the router's placeholder key.
- `X-Platform-Harness: hermes` both on the provider and in `model.default_headers`, since Hermes's auxiliary calls (titles, compression) read only the latter.
- `mcp_servers`: the entries of `~/.hermes/platform-mcp.json`, which the runtime writes as JSON; Hermes reads its MCP servers only from YAML.
- `approvals.mode: off`, since nobody answers a prompt on a schedule or a channel turn.
- `security.allow_lazy_installs: false`, and `skills.external_dirs` with `~/.agents/skills`, where the platform installs skills.

For chat sessions it then starts `hermes acp` with two fixes to its ACP agent:

- The runtime sends a session's model as the `model` config option before every prompt, as `custom:platform:<qualified name>`.
  Hermes stores config options without using them and switches models only on `session/set_model`, so the launcher calls that when the model changes.
  `session/set_model` builds a new agent without the MCP servers the session got in `session/new`, so the launcher registers them again.
- Hermes starts every session on its `default` mode, which asks before each file edit.
  The launcher starts a session on the mode in `~/.hermes/platform-settings.json`, which the Config panel writes, else `dont_ask`.

## Models

Hermes's calls carry no session id, so the router routes a call by its qualified model name alone.
While exactly one Hermes session runs a turn, the router books the call to it (`sessionFromRunningTurn`).
The runtime names the default provider's first model in `PLATFORM_MODEL` (`defaultModelEnv`), which the launcher writes as `model.default`.

## Known gaps

- The platform instructions in `/etc/AGENTS.md` are not loaded: Hermes reads `AGENTS.md` only from the session's working directory.
- On a model's first use Hermes probes the endpoint for metadata (`/api/v1/models`, `/api/show`, `/v1/models/<id>`); the router answers only `/v1/models`.
- Terminal sessions run plain `hermes`; they do not resume the platform session's conversation.
