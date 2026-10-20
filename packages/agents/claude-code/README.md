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

Files a user attaches to a message, and files a channel brings in, land under `~/.uploads/`, outside the session's working directory.
`managed-settings.json` allows `Read(~/.uploads/**)`, so a session in "Ask for approvals" reads them without asking.
The rule covers every session's attachments: the sessions of one agent share its home, so it reaches no file the agent could not already read.

## Model Router

Every provider but Bedrock (the LiteLLM proxies, the Anthropic key and subscription) reaches Claude Code through the agent-runtime [Model Router](../../../docs/architecture/harness-config.md#the-model-router): [`model-gateway.sh`](rootfs/usr/local/lib/model-gateway.sh), sourced by `harness-chat`, `harness-terminal` and the login profile, repoints `ANTHROPIC_BASE_URL` at the router, names the harness with `ANTHROPIC_CUSTOM_HEADERS`, turns on gateway model discovery and drops a provider's `ANTHROPIC_MODEL` pin, since the session's model is a per-turn choice the runtime sends over ACP.
The router serves `/v1/models` as `claude/<alias>/<id>` names (Claude Code's discovery keeps only ids containing `claude`, lowercased), routes each call by that name and rewrites the response's model to it so the transcript records the provider.
The runtime fills the tier slots (`ANTHROPIC_DEFAULT_{FABLE,OPUS,SONNET,HAIKU}_MODEL`) with the agent's default provider's newest model of each tier and caps `CLAUDE_CODE_MAX_CONTEXT_TOKENS` at the smallest window the agent may run on.
The subagent model is a session setting (`subagentModel`) delivered as `CLAUDE_CODE_SUBAGENT_MODEL` with `CLAUDE_CODE_SUBAGENT_MODEL_FORCE`, so a session that picks one runs in a Claude process of its own and neither an Agent tool call's model argument nor an agent definition's model outranks it.
The subagent effort (`subagentEffort`) is the router's: it replaces the `output_config.effort` a subagent's call carries.
Neither reaches a platform sub-agent, which follows the session's platform sub-agent settings.
The router adds the OAuth beta flag to a call on the subscription; Bedrock stays on Claude Code's native path (`CLAUDE_CODE_USE_BEDROCK`).
Workload images extend the shim through `model-gateway.d/*.sh` (Nous does, for its own OpenAI-format calls).
