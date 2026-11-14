# Claude Code harness

The harness ships in the default image every harness Template boots, built by `//packages/agents:oci` from the shared base in [`packages/agents/base`](../base/) (see [agent images](../../../docs/architecture/agent-images.md)): its tools, declared in [`image.toml`](image.toml), are baked into the default image's harness tools layer, and its files live at their image paths under [`rootfs/`](rootfs/).

```sh
mise run //packages/agents:oci -- default   # add --build to skip the registry
```

Cross-session messaging is off.
Claude Code can list the other Claude sessions on its host and message them with `SendMessage`, which would let the sessions of one agent reach into each other.
`harness-chat` and `harness-terminal` set `CLAUDE_CODE_HARBOR_KITE=0`, which drops the peer listing and the peer targets of `SendMessage`.
`SendMessage` stays for the session's own subagents.
[`managed-settings.json`](rootfs/etc/claude-code/managed-settings.json) also sets `crossSessionInbound: refuse`, so a session turns away a peer message that gets through anyway.

The model cannot put a session into plan mode.
In plan mode every edit and command waits for an approval, and nobody is there to give one on a Slack or scheduled turn.
`managed-settings.json` denies `EnterPlanMode`, so Claude Code leaves the tool out of the model's tool list, whatever the permission mode, and user or project settings cannot allow it again.
A person can still turn plan mode on: the session's mode setting (ACP `session/set_mode`), `--permission-mode plan` or Shift+Tab in the terminal.
`ExitPlanMode` stays, so a session in plan mode can still present its plan.

Files a user attaches to a message, and files a channel brings in, land under `~/.uploads/`, outside the session's working directory.
`managed-settings.json` allows `Read(~/.uploads/**)`, so a session in "Ask for approvals" reads them without asking.
The rule covers every session's attachments: the sessions of one agent share its home, so it reaches no file the agent could not already read.

## User settings

[`sync-claude-settings.mjs`](rootfs/usr/local/lib/sync-claude-settings.mjs) writes the platform's own keys into `~/.claude/settings.json`: the `OTEL_*` telemetry variables of the rail the agent was given, and the `report-background-work.mjs` entry it owns in `hooks.Stop` and `hooks.SubagentStop`.
It runs in the ACP adapter's node before the adapter's first line, and once more before a web terminal's `claude`, and it touches no key it does not own.
That file has more than one writer — this sync, agent-runtime's harness-config driver, and a starter kit's own install — so this sync and the runtime both take `~/.claude/settings.json.lock` across their whole read-modify-write and rename a temporary file of their own into place ([the write rule](../../../docs/architecture/runtime-delivery.md#writing-a-file)); a kit's install and Claude Code itself take no lock and can still lose a change to each other or to one of these two.
A file the sync cannot read or parse is kept byte for byte and named on stderr, and only a missing file starts from `{}`.

## Agent instructions

The platform instructions reach Claude Code as its managed memory file: the image links `/etc/claude-code/CLAUDE.md` to `/etc/AGENTS.md`, so an owner's file cannot replace them.
Claude Code walks up from the work directory, so it finds the agent's own `~/AGENTS.md` and `work/AGENTS.md` with no link ([agent instructions](../../../docs/architecture/agent-images.md#agent-instructions)).
On its own, Claude Code drops every `AGENTS.md` once a `CLAUDE.md` sits anywhere on that walk, `~/CLAUDE.md` or a repository's included.
So `managed-settings.json` sets its built-in AGENTS.md plugin (`agents-md@builtin`) to `instructionFiles: claude-md-and-agents-md`, which loads every `AGENTS.md` beside the `CLAUDE.md` files.
A file that a `CLAUDE.md` already imports or links to, or that holds the same text, is not loaded twice.
Managed settings win over the owner's settings, so an owner cannot turn `~/AGENTS.md` off.

## Model Router

Every provider but Bedrock (the LiteLLM proxies, the Anthropic key and subscription) reaches Claude Code through the agent-runtime [Model Router](../../../docs/architecture/harness-config.md#the-model-router): [`model-gateway.sh`](rootfs/usr/local/lib/model-gateway.sh), sourced by `harness-chat`, `harness-terminal` and the login profile, repoints `ANTHROPIC_BASE_URL` at the router, names the harness with `ANTHROPIC_CUSTOM_HEADERS`, turns on gateway model discovery and drops a provider's `ANTHROPIC_MODEL` pin, since the session's model is a per-turn choice the runtime sends over ACP.
The router serves `/v1/models` as `claude/<alias>/<id>` names (Claude Code's discovery keeps only ids containing `claude`, lowercased), routes each call by that name and rewrites the response's model to it so the transcript records the provider.
The runtime fills the tier slots (`ANTHROPIC_DEFAULT_{FABLE,OPUS,SONNET,HAIKU}_MODEL`) with the agent's default provider's newest model of each tier, and the auto-mode classifier through `CLAUDE_CODE_AUTO_MODE_MODEL` from the platform's preferred classifier, so the Sonnet slot stays the person's; a default provider with no preferred classifier leaves the knob unset.
It sets `CLAUDE_CODE_MAX_CONTEXT_TOKENS` to the widest window the agent may run on — not a cap, but what an id Claude Code does not recognise runs with — and writes each model's own window into `modelSettings.<name>.autoCompactWindow` in `~/.claude/settings.json`, which is what makes a 1M model compact at its ceiling and follows a mid-session model switch.
Claude Code reads neither the window from `/v1/models` (discovery keeps only id, display name and description) nor a per-model settings file of its own from a repository: a top-level `autoCompactWindow` there replaces the map, so no repository setting is set for it.
The shim also turns on `CLAUDE_CODE_GATEWAY_HINT_HEADERS`, so Claude Code classes each call, and the router moves a side call (a title, a WebFetch summary, an alias-named subagent) on a tier slot to the session provider's model of that tier when the session runs on another provider; a main-conversation turn is never moved, and the classifier's own call (above), which is auxiliary and carries no subagent id, goes to the session provider's classifier instead of a tier, unless the session runs server-side auto mode (a Claude model on Anthropic or IBM, with no non-Claude subagent model) and keeps it.
The subagent model is a session setting (`subagentModel`) delivered as `CLAUDE_CODE_SUBAGENT_MODEL` with `CLAUDE_CODE_SUBAGENT_MODEL_FORCE`, so a session that picks one runs in a Claude process of its own and neither an Agent tool call's model argument nor an agent definition's model outranks it.
The subagent effort (`subagentEffort`) is the router's: it replaces the `output_config.effort` a subagent's call carries.
Neither reaches a platform sub-agent, which follows the session's platform sub-agent settings.
The router adds the OAuth beta flag to a call on the subscription; Bedrock stays on Claude Code's native path (`CLAUDE_CODE_USE_BEDROCK`).
Workload images extend the shim through `model-gateway.d/*.sh` (Nous does, for its own OpenAI-format calls).

## The platform's MCP server

Every session carries the platform's own MCP server beside the ones its connections add, and that is where schedules, artifacts, `spawn_subagent` and channel messaging come from.
Claude Code caches a server that answered as if it needs authentication in `~/.claude/mcp-needs-auth-cache.json` and skips it for 15 minutes; it reads that file once per process, so the skip outlives every session of that process.
One mesh blip — a `403` with `RBAC: access denied` from the Istio policy — therefore left every session of an agent on dam-dev without those tools until the entry expired, and Claude Code told the user to authorise the server in `/mcp` or its connector settings, which no DAM agent has.
So [`forget-platform-mcp-auth.mjs`](rootfs/usr/local/lib/forget-platform-mcp-auth.mjs) drops the platform's own servers (`platform-outbound`, `knowledge-bases`) from that cache, and `harness-chat` and `harness-terminal` run it before Claude Code starts, so no process inherits a stale entry; a server of the agent's own keeps its entry, since a person may have signed it in.
A process that hits the blip itself still skips the server until it restarts or the entry expires, because the cache is read once and held in memory.
