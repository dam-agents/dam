# Claude Code agent image

Built with `mise oci` from the shared base in [`packages/agents/base`](../base/) (see [`packages/agents`](../README.md)): the `claude-code` config environment, [`image.toml`](image.toml), over the shared Debian base. The harness's files live at their image paths under [`rootfs/`](rootfs/).

```sh
mise run //packages/agents:image -- claude-code   # add --build to skip the registry
```

The workload images (nous, openevolve, shinkaevolve, gepa, skydiscover) are built on this one.
