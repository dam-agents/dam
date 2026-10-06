# Claude Code harness

The harness ships in the default image every harness Template boots, built by `//packages/agents:oci` from the shared base in [`packages/agents/base`](../base/) (see [agent images](../../../docs/architecture/agent-images.md)): its tools, declared in [`image.toml`](image.toml), come from the node's harness tools, and its files live at their image paths under [`rootfs/`](rootfs/).

```sh
mise run //packages/agents:oci -- default   # add --build to skip the registry
```
