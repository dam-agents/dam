# ADR-039: Platform CLI foundation — Node-on-npm, tRPC contract reuse

**Date:** 2026-05-05
**Status:** Accepted
**Owner:** @PetrBulanek

## Context

[ADR-037](037-remote-terminal.md) committed to a "terminal" session mode and anticipated a follow-up ADR designing the CLI counterpart to the web terminal view, "reusing the same communication interface." This is that ADR — but scoped narrower than the full CLI surface. We decide only the **foundation** here: how to build, ship, and configure a `dam` binary that future verbs plug into.

The driver is the May 18 demo. The story is "I install the CLI, point it at a hosted Platform deployment, and start coding." There is no entry point today other than the web UI.

This ADR implements [#79](https://github.com/dam-agents/dam/issues/79). Subsequent verbs — `dam login` ([#80](https://github.com/dam-agents/dam/issues/80)), instance addressing ([#81](https://github.com/dam-agents/dam/issues/81)), `dam shell` ([#86](https://github.com/dam-agents/dam/issues/86)), `dam import` ([#73](https://github.com/dam-agents/dam/issues/73)) — are out of scope and will land in their own ADRs or specs. The foundation must not foreclose any of them.

## Decision

**The CLI is a TypeScript Node package, distributed via npm, that shares the API server's tRPC contract directly.** It runs on the user's installed Node — no bundled runtime. Cross-platform reach is macOS + Linux + Windows-via-WSL2. Configuration follows the AI-CLI category convention (`~/.dam/`) rather than XDG.

The load-bearing rules:

- **One language stack.** TypeScript, the same stack as the API server and UI ([ADR-009](009-go-and-typescript.md)). The CLI imports `api-server-api` directly and consumes the tRPC contract end-to-end-typed; every server-side type change reaches the CLI without codegen or manual mirroring. This is the single biggest leverage point and the reason TypeScript wins over Go, Rust, or Python here.
- **Ship as a Node script, not a native binary.** `npm install -g @dam-agents/cli` is the only install path. Users must have Node ≥ 20.
- **Config lives at `~/.dam/config.toml`.** The AI-CLI category convention is to put state in `~/.<vendor>/`; the audience expects that location. TOML for hand-edit ergonomics and comment support. Auth credentials and other state will share the `~/.dam/` tree but explicitly not this file.
- **Flat config schema; no profiles.** A single configured server, no `current-profile` indirection.
- **Configuration precedence: flag > env > file > error.** No silent default for the server URL. The CLI errors with a setup hint when nothing is configured.
- **Independent semver, server-advertised compatibility floor.** The CLI versions independently of the platform. The server exposes an unauthenticated version endpoint returning its own version and the minimum CLI version it accepts. The CLI hard-refuses to run if below the floor and soft-warns to stderr if behind current. The endpoint is plain HTTP, deliberately outside the tRPC surface so it can be called before any authentication or client setup.
- **No telemetry.** The platform collects nothing today and the CLI does not break that posture.

## Scope boundaries

This ADR explicitly does *not* decide:

- **Authentication.** Token format, storage, OIDC flow shape — all owned by [#80](https://github.com/dam-agents/dam/issues/80). Only commitment here: credentials live somewhere under `~/.dam/`, not inside `config.toml`.
- **Instance addressing.** Name resolution and how the CLI selects an instance belong to [#81](https://github.com/dam-agents/dam/issues/81).
- **Streaming transport for `dam shell`.** [#86](https://github.com/dam-agents/dam/issues/86) extends the foundation with a WebSocket attach. tRPC supports WebSocket links, so the extension is bounded.
- **Workspace import.** Owned by [#73](https://github.com/dam-agents/dam/issues/73).
- **The full CLI command tree.** Only the foundation verbs (version, help, server-config, connectivity check) are in scope. Every other verb in [Epic #71](https://github.com/dam-agents/dam/issues/71) lands in its own work item.
- **Implementation specifics** — exact env var names, exit codes, command names, build tool, library choices. Those belong in a spec or the implementation PR.

## Alternatives Considered

- **Native binary distribution (Bun-compile, brew, curl-pipe).** Polished install story, no Node prerequisite. Rejected on demo-deadline grounds: the engineering cost (CI matrix, code-signing, install-script hosting) buys polish the demo doesn't need, and the npm-script path does not block the migration.
- **Go or Rust for the CLI binary.** Smaller binaries, no Node prerequisite. Rejected because both throw away tRPC contract reuse — every API change becomes a two-place edit, forever — and add a third language stack to the repo.
- **Python.** Considered. Rejected on three grounds: zero code reuse with the tRPC contract, weaker single-binary distribution story than TypeScript, and a third language stack to maintain.
- **XDG-compliant config path.** Matches generic developer-tool precedent. Rejected because the AI-CLI audience expects `~/.<vendor>/`; matching the audience's muscle memory beats matching a different audience's precedent.
- **Profiles from day one.** Rejected on YAGNI grounds; the migration path remains open as a non-breaking on-read rewrite.
- **Native Windows support.** Rejected because native Windows pulls forward design work for [#86](https://github.com/dam-agents/dam/issues/86) (Windows PTY differs) and expands the test matrix during demo crunch. WSL2 is supported transparently — it is just Linux from the binary's perspective.
- **REST + manual fetch instead of tRPC client.** Rejected because it discards the entire reason TypeScript was chosen over Go/Rust.
- **`/version` inside the tRPC surface.** Rejected because the version check must run before authentication and before any client setup; a plain HTTP endpoint is simpler and useful for non-CLI consumers (uptime checks, ops tooling) too.
- **Opt-out anonymous telemetry.** The standard pattern in many developer CLIs. Rejected because it would be inconsistent with the platform's broader posture; flipping just the CLI to phone-home would be a surprise.

## Consequences

- The CLI ships on a tighter timeline because npm-only distribution skips CI matrix, code-signing, and install-script hosting. Every future verb the team adds — login, instances, shell, import — inherits the foundation without re-litigating.
- Every server-side tRPC contract change automatically reaches the CLI's type system. There is no contract-drift risk between UI and CLI; both consume the same package.
- Users without Node ≥ 20 cannot install the CLI. Install docs must call this out.
- Native Windows users must use WSL2.
- The CLI has no ability to phone home, including for crash data. Bug reports rely on user-supplied output. Diagnostic ergonomics are a spec concern.
- The configured server URL lives in plain text on disk. Auth tokens do not — that is [#80](https://github.com/dam-agents/dam/issues/80)'s problem; this ADR's `config.toml` pattern explicitly does not constrain credential storage.
- The package publishes as `@dam-agents/cli` (matching the GitHub organization). The project-wide license decision is a prerequisite for first publication and is out of scope for this ADR.

## Future considerations

Items deliberately not committed by this ADR. Each is an explicit future decision, not a quiet drift:

- **Native-binary distribution** — Bun-compiled binary, brew tap, curl-pipe install script, GitHub Releases binaries, or native-binary npm wrapping. The migration is non-breaking from the user's perspective: `npm install -g @dam-agents/cli` keeps working through any later switch.
- **Profiles** — multi-server / multi-context support. Migration from the flat schema to a profile-shaped one is a non-breaking on-read rewrite.
- **Native Windows support** — covered via WSL2 today. Native support reopens when [#86](https://github.com/dam-agents/dam/issues/86) ergonomics or audience demand warrant the PTY divergence cost.
- **Telemetry and crash reporting** — explicitly out today. Revisitable when the command surface grows enough that "which commands fail" becomes a real product question.

## Related ADRs

- [ADR-037](037-remote-terminal.md) — predecessor; this ADR is the follow-up it explicitly anticipated.
- [ADR-009](009-go-and-typescript.md) — language split that makes TypeScript the default outside the controller.
- [ADR-022](022-harness-api-server.md) — separate-port API surface; the unauthenticated `/version` endpoint lives in this style.
