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

Configuration lives at `$XDG_CONFIG_HOME/dam/config.toml` (default `~/.config/dam/config.toml`).
State and credentials live separately under `$XDG_STATE_HOME/dam/` (default `~/.local/state/dam/`).

## Use it from your own agent

The CLI comes with a skill that teaches an agent on your machine — Claude Code, Codex, or any agent that loads skills — to drive DAM with this CLI.
The agent never sees a secret: whenever DAM needs one, it gives you a command to run in your own terminal.

```sh
npx skills add https://dam.example.com -g
```

Replace the address with your DAM deployment's: it serves the skill that matches its server.
Or install it from this repository, at the version `dam --version` prints, so the skill matches your CLI:

```sh
npx skills add 'dam-agents/dam/skills/dam#v0.2.24' -g
```

The skill ships from CLI 0.2.24 on: with an older CLI, update the CLI first.

## Links

- [Source](https://github.com/dam-agents/dam/tree/main/packages/cli)
- [Issues](https://github.com/dam-agents/dam/issues)

## License

[Apache-2.0](./LICENSE)
