# @dam-agents/cli

Command-line interface for [DAM](https://github.com/dam-agents/dam) — run your own background AI coding agents on Kubernetes.

## Install

```sh
npm install -g @dam-agents/cli
```

Requires Node ≥ 20.

## Usage

```sh
dam --help
dam --version
```

Configuration lives at `$XDG_CONFIG_HOME/dam/config.toml` (default `~/.config/dam/config.toml`). State and credentials live separately under `$XDG_STATE_HOME/dam/` (default `~/.local/state/dam/`).

## Links

- [Source](https://github.com/dam-agents/dam/tree/main/packages/cli)
- [Issues](https://github.com/dam-agents/dam/issues)

## License

[Apache-2.0](./LICENSE)
