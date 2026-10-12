# Claude Code harness

The harness ships in the default image every harness Template boots, built by `//packages/agents:oci` from the shared base in [`packages/agents/base`](../base/) (see [agent images](../../../docs/architecture/agent-images.md)): its tools, declared in [`image.toml`](image.toml), come from the node's harness tools, and its files live at their image paths under [`rootfs/`](rootfs/).

```sh
mise run //packages/agents:oci -- default   # add --build to skip the registry
```

Cross-session messaging is off. Claude Code can list the other Claude sessions on its host and message them with `SendMessage`, which would let the sessions of one agent reach into each other. `harness-chat` and `harness-terminal` set `CLAUDE_CODE_HARBOR_KITE=0`, which drops the peer listing and the peer targets of `SendMessage`. `SendMessage` stays for the session's own subagents. [`managed-settings.json`](rootfs/etc/claude-code/managed-settings.json) also sets `crossSessionInbound: refuse`, so a session turns away a peer message that gets through anyway.
