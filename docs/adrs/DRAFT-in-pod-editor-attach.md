# ADR-NNN: In-pod editor attach via SSH-over-WebSocket

**Date:** 2026-05-20
**Status:** Proposed
**Owner:** @tomkis

## Context

Users want to drive an agent pod from their local editor — edit files Claude Code is working on, open multiple terminals, run language servers and extensions — while the agent itself keeps running. Today the only inbound channel into a pod is the chat/terminal relay, a single-PTY pipe to one hardcoded TUI. It can't carry the multiplexed traffic an editor needs (file sync, language server, parallel shells), and it gives no way to ship an editor's remote backend into the pod.

## Decision

For the in-pod editor prototype, agent pods optionally run an SSH daemon, and SSH bytes are tunneled to the user's machine through the api-server's existing WebSocket auth route. Any SSH-capable editor (VSCode Remote-SSH, JetBrains Gateway, Zed, Cursor, plain `ssh` + terminal editors) attaches the same way; the prototype ships VSCode as the reference client because it has the broadest install base, but the pod-side and transport are editor-agnostic. The api-server's JWT auth is the only access gate.

The daemon is opt-in per instance, activated by a flag at instance creation. The user's keypair is generated locally at that moment, the public key rides into the pod through the existing env-var plumbing, and the private key never leaves the user's machine. No state about the editor lives in the api-server or DB.

Environment that the agent process relies on (credential proxy variables, gateway CA trust) is snapshotted at pod start so SSH sessions inherit it. Without that, anything launched from the editor's terminal can't reach the credential gateway.

## Alternatives Considered

- **VSCode Remote Tunnels** — requires every user to authenticate `code tunnel` against a Microsoft or GitHub account per session, and routes editor traffic through Microsoft's relay infrastructure instead of our own auth.
- **code-server / openvscode-server in a browser tab** — drops local VSCode entirely; loses Microsoft-marketplace extensions including any official editor integration, and gives no path to reuse the user's local settings.
- **`kubectl port-forward` to the pod's SSH port** — requires distributing a kubeconfig with pod/portforward rights to every CLI user, sidestepping the JWT auth and ownership checks the api-server already enforces.
- **Reuse the chat/terminal relay** — its frame protocol is a single PTY channel; SSH needs concurrent multiplexed channels (sftp + shell + port-forward + extension host) and a standards-compliant transport so VSCode's installer and rsync work.

## Consequences

- **Easier:** A fourth attach mode can be added as one regex branch in the WS-upgrade handler — auth, ownership, and ingress routing are already shared with the chat and ACP relays.
- **Easier:** Users keep their local editor, its marketplace, and their personal settings; this is the only path among the alternatives that preserves all three.
- **Easier:** Editor portability is free — JetBrains Gateway, Zed remote, plain SSH, etc., reach the same pod with no server-side change. The choice of editor stays with the user, not with the platform.
- **Harder:** Adds an SSH daemon to the claude-code image and a long-lived listener inside the agent pod. Threat model is now "anyone with a valid user JWT for this instance can run arbitrary commands as the agent user" — same blast radius as `dam chat`, but reachable in more ways.
- **Harder:** SSH sessions do not inherit the container environment by default, so credential-proxy variables must be re-injected via a startup snapshot. Anything the agent process picks up after pod start (rotated tokens, runtime-set env) will be stale in editor shells.
- **Harder:** First attach uploads the editor's remote backend (~150 MB for vscode-server, similar order for JetBrains) into the pod's $HOME and persists it on the workspace volume across restarts. Re-attaches are fast; cold attaches on freshly-built images aren't.
- **Committed-to:** The api-server's `/api/instances/:id/<channel>` WS-upgrade handler as the single auth front door for any future pod-attached protocol. Adding a fifth port would mean another branch here, not another auth gate elsewhere.
