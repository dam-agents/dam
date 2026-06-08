# ADR-062: SSH access to agents via an in-pod inetd sshd tunneled over the agent WebSocket

**Date:** 2026-06-02
**Status:** Accepted
**Owner:** @JanPokorny

## Context

`dam chat` ([ADR-037](037-remote-terminal.md)) connects a local terminal to an agent's
PTY over a WebSocket relayed by the api-server. Users want the same reach but via
**standard SSH** — the real `ssh` client, `scp`/`sftp`, port-forwarding, and especially
**VS Code Remote-SSH** — pointed at an agent.

Constraints that shape the design:

- The agent pod's NetworkPolicy admits ingress on its single port (`:8080`) only from the
  api-server pod ([ADR-038](038-paired-gateway-pod.md)). There is no path to expose a new
  SSH port to the outside.
- The agent runs as a non-root user (uid 65532) on a hardened base image; there is no
  init system, just the agent-runtime process.
- The api-server already authenticates every WebSocket upgrade (JWT → ownership → terms
  acceptance) before relaying to a pod.

## Decision

**Run a real OpenSSH `sshd` inside the agent pod, spawned per-connection in inetd mode
(`sshd -i`) by the agent-runtime, and tunnel the raw SSH byte-stream over a new
`/api/ssh` WebSocket. SSH terminates at the in-pod sshd; the CLI and api-server only move
bytes.**

- **Transport.** A new agent-runtime endpoint `/api/ssh` spawns one `sshd -i` per
  connection and bridges the child's stdin/stdout (the SSH transport) to the socket. The
  api-server adds an `ssh` relay kind alongside `acp`/`terminal`, reusing the same upgrade
  auth and forwarding bytes verbatim. **No listening port, no NetworkPolicy change, no
  pod-spec change** — SSH rides the existing `:8080` WebSocket and its auth boundary.
- **CLI.** `dam ssh` is a command group. The hidden `dam ssh _proxy <agent>` is an ssh
  `ProxyCommand`: it opens the WebSocket and shovels raw bytes between it and stdin/stdout.
  `dam ssh connect <agent>` launches the system `ssh` configured to use that proxy;
  `dam ssh connect -x code <agent>` launches `code` with a Remote-SSH target backed by the
  same proxy, and `-x zed` does the same for Zed. A single `-x`/`--exec` flag picks the
  client binary, with an optional `:<mode>` suffix (`ssh`|`code`|`zed`) forcing how it's
  invoked when the name isn't self-describing (e.g. `-x code-insiders`). `dam ssh configure
  (<agent> | --all | --clear)` writes the managed host config (one block, or one per agent)
  and exits without launching a client; `--all` reconciles — it also prunes blocks for
  agents that no longer exist — and `--clear` removes every managed block. (Editor support beyond VS Code and Zed — e.g. JetBrains
  Gateway — is out of scope for the MVP.)
- **Auth.** Public-key. The CLI keeps a dam-managed keypair under the XDG state dir and,
  on each `_proxy` connect, registers the public key with the agent via a new
  `ssh.authorizeKey` tRPC mutation (proxied through the existing `/api/agents/:id/trpc`
  route) before connecting. `sshd -i` runs as uid 65532 and authenticates the same user —
  **no root required** (verified: pubkey auth + bash login + PTY + sftp all work as 65532).
  The dam key is the transport credential only; the user's real identity was already
  verified at the api-server upgrade.

## Considerations

- Per-connection inetd means per-connection isolation and no long-running listener to
  supervise; concurrent SSH sessions to one agent coexist (each its own `sshd`).
- **Host-key checking is disabled** on the CLI side (`UserKnownHostsFile=/dev/null`,
  `StrictHostKeyChecking=no`, `LogLevel ERROR`). The real trust boundary is the api-server
  WebSocket upgrade (JWT → ownership → terms) and the byte-stream is already TLS-encrypted
  end to end, so the in-pod sshd host key authenticates nothing the upgrade hasn't. Pinning
  it only caused breakage: the agent generates its host key on first boot, it does *not*
  survive a PVC recreation, and a pinned entry then *hard-refuses* the changed key ("HOST
  IDENTIFICATION CHANGED") instead of reconnecting — forcing manual `known_hosts` surgery.
  Throwing the key away (`/dev/null`) keeps `ssh` happy across rotations with zero state;
  `LogLevel ERROR` mutes the resulting per-connect "Permanently added" notice. The
  dam-managed keypair remains the *client* credential the agent authorizes per-connect.
- `StrictModes` is disabled in the sshd config: the security boundary is the api-server
  upgrade + NetworkPolicy, not file-mode checks on a single-user pod.
- **Environment parity.** sshd resets the environment before the login shell, so an SSH
  session would otherwise start with none of the agent's pod env — no `HTTPS_PROXY` (egress
  is proxy-only, so even DNS resolution fails), no credential sentinels, no harness `PATH`.
  The agent-runtime rebuilds `~/.ssh/environment` on **each connection** — from the
  runtime-channel injected env overlaid with the pod env (`process.env` wins on collision,
  the same precedence the terminal PTY spawn uses) — and sets `PermitUserEnvironment yes`,
  so every session (shell, `ssh <agent> <cmd>`, sftp/scp) gets the same networking and
  credentials the harness has. Per-connection rather than per-boot because env injection is
  now hot: connection and credential env land in the runtime-channel env file without a pod
  restart ([env injection without pod rolls](DRAFT-runtime-env-injection.md)), so a boot
  snapshot would go stale the moment a user adds a connection. The freshness boundary is the
  **connection**: a user picks up an env change by reconnecting. The rewrite is synchronous +
  atomic (temp + rename) immediately before sshd spawns, so the freshly spawned sshd reads
  the new file and a concurrent session never sees a torn one. The host key, by contrast,
  persists across boots. `PermitUserEnvironment` is safe here for the same reason
  `StrictModes` is off — the SSH user *is* the single pod user (uid 65532), so the usual
  `LD_PRELOAD` privilege-escalation concern crosses no boundary.
- `dam ssh`'s editor modes (`-x code`, `-x zed`) keep dam's
  `Host` blocks in dam's own `$XDG_CONFIG_HOME/dam/ssh_config` and add a single
  `Include` line to `~/.ssh/config` so the editor's SSH client resolves the
  agent. That one `Include` is the only CLI write outside the XDG dirs — ssh has
  no env-var override for its config location, and editors are often
  already-running singletons that ignore a launch-time `PATH`/`HOME`, so an
  `Include` is the reliable cross-editor hook. Called out in
  [cli.md](../architecture/cli.md).
- The persisted `ProxyCommand` is a small `sh` fallback script, not a frozen absolute
  path, because the same editor-singleton problem applies: a config block written once
  must keep working after the CLI moves (node-version switch, reinstall) or when an editor
  spawns it without the user's shell `PATH`. It tries, in order, the node+script resolved
  at write time, `node`+script on `PATH`, `dam` on `PATH`, then `dam` as found by an
  rc-loaded `zsh`/`bash`; discovery never writes to the stdin/stdout that carry the SSH
  transport. `dam ssh connect -x <editor>` also re-upserts the block each launch, so the
  common path self-heals.
- SSH is available on every agent image: `sshd` and the canonical `/bin/bash` login user
  live in `platform-base`, which all harness images (claude-code, codex, pi-agent, bob, the
  e2e mock) build on. The runtime still degrades cleanly if a future image strips `sshd`
  from the base — `prepareSshd` returns null and `/api/ssh` refuses the upgrade — but no
  shipped image exercises that path today.
- **An open SSH session keeps the agent awake.** Like `dam chat` and the web terminal, an
  open connection marks `active-session`, and the controller bypasses the idle timeout
  while that pin is set (`hibernation.go`). All three relays (acp, terminal, ssh) share one
  counter that owns the pin — true while ≥1 connection of any type is open — so closing a
  terminal can't clear a live SSH session's pin. This is intended (a connected editor is
  "in use"), but the byte stream is opaque, so the relay can't tell a real keystroke from a
  VS Code Remote-SSH keepalive. A forgotten, still-connected editor window therefore keeps
  the agent running (and billing); **close it to let the agent hibernate.** Two safety nets
  keep the pin honest: a per-connection WS ping/pong terminates a half-open client
  (releasing it), and the api-server clears all pins at boot, since a fresh process holds no
  connections so any surviving pin is stale.

## Alternatives considered

- **Embedded SSH server in the CLI** (terminate SSH locally; tunnel only the
  resulting shell stream over the WebSocket, exactly like `dam chat`). Needs no
  image change, but `ssh`'s `ProxyCommand` always speaks SSH to a server, so
  this means embedding a full SSH server in the CLI and re-implementing exec,
  sftp, and port-forwarding there — plus a new generic command-exec capability
  in the agent-runtime — to make VS Code Remote-SSH work. Far more code, worse
  compatibility. Rejected.
- **Persistent sshd listener on `127.0.0.1:<port>`** in the pod with a TCP relay from
  `/api/ssh`. Equivalent auth/CLI surface; kept as the fallback if non-root inetd ever
  regresses, but rejected for v1 in favor of the simpler per-connection inetd (no
  long-running process or port to manage).
