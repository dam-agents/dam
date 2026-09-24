# Claude Code agent image

Built with `mise oci` from [`packages/mise-oci`](../../mise-oci/): the `claude-code` config environment, [`harness.claude-code.toml`](../../mise-oci/image/mise/conf.d/harness.claude-code.toml), over the shared Debian base. The harness's files live at their image paths under [`packages/mise-oci/image/harness/claude-code/`](../../mise-oci/image/harness/claude-code/).

```sh
mise run //packages/agents:image -- claude-code   # or //packages/mise-oci:image -- claude-code --load
```

The workload images (nous, openevolve, shinkaevolve, gepa, skydiscover) are built on this one.
