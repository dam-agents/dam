# CLI

Last verified: 2026-10-29

## Overview

The `dam` CLI is a TypeScript Node package, distributed via npm, that users install on their own machine and point at a configured Platform deployment.
It never runs inside the cluster.
It reaches the api-server as a thin client: it shares the api-server's contract package directly, so server-side type changes reach the CLI without codegen or manual mirroring, and it calls the tRPC surface over plain HTTP for everything except the interactive `dam chat` session, which opens a WebSocket to the terminal relay.
Command groups are singular (`agent`, `connection`, `channel`, …) to match `gh`, `git`, and `docker`.

The CLI is at parity with the web UI: every action a user can take in the browser has a verb.
It owns no domain logic of its own — each command group is a thin surface over the api-server procedures the corresponding subsystem already exposes, so the concepts live on their owning architecture pages (see [Command surface](#command-surface)).

## Trust boundary

The CLI runs on the user's machine.
It reads and writes only under the XDG config and state directories and makes outbound network calls only to the configured server.
There is no telemetry and no anonymous reporting — the platform collects nothing, and the CLI does not break that posture.

One deliberate exception is `dam ssh`'s editor modes: dam's own SSH host entries live in `$XDG_CONFIG_HOME/dam/ssh_config`, and a single `Include` line is added to `~/.ssh/config` so an external editor's SSH client can resolve the agent host.
dam never touches the user's own `~/.ssh` keys (see [SSH access](#ssh-access)).

The other exception is CLI version management: `dam version` and `dam update` ask the npm registry for the `latest` dist-tag of `@dam-agents/cli`, so they can find an out-of-date CLI even when the server cannot.
It asks `registry.npmjs.org`, or the registry in `npm_config_registry` when that variable is set.
`dam update` then runs npm to replace a global CLI installation with that exact stable version; it never invokes `sudo`, changes CLI state or contacts a Platform deployment.
These commands send nothing about the user, and no other verb makes the registry call.

## Config

Two persistence concerns split across the XDG directories: editable configuration and credentials.

- **Configuration** lives at `$XDG_CONFIG_HOME/dam/config.toml` — a flat schema, no profile indirection.
  Its v0 key is the active server URL.
  New keys are registered at compile time; an undeclared key is a build error.
- **Credentials** live separately under `$XDG_STATE_HOME/dam/`, written by `dam auth login` (see [Authentication](#authentication)).
- **Resolution precedence** at invocation time is flag > env var (`DAM_SERVER`, and `DAM_<KEY>` for future keys) > file > error.
  There is no silent default.
- **Writes are read-merge-rename**: the CLI never discards unrelated top-level keys, so a user can hand-edit comments or future knobs without losing them.

## Compatibility negotiation

Before any networked verb runs, the CLI hits the api-server's unauthenticated version endpoint (plain HTTP, outside the tRPC surface) to learn the server's version, the minimum CLI version it accepts, and the CLI version it recommends.
The server's version is the release it was built from, the chart's `appVersion`: a tagged release reports `X.Y.Z` or `X.Y.Z-rcN`, and a build from `main` reports `X.Y.Z-dev-<sha>`.
A tagged release recommends the CLI of its own version, which CD publishes to npm with it; a build from `main` recommends none, because no CLI is published at its version.
Three verdicts:

- **Ok** — the local CLI is at or ahead of the recommended CLI, or the server recommends none; the command proceeds.
- **BehindCurrent** — below the recommended CLI but at or above the floor; the CLI warns to stderr and proceeds.
- **BelowFloor** — below the server's advertised minimum; gated verbs hard-fail, informational verbs proceed.

When the server advertises no floor, BelowFloor is never produced.
The floor is operator-configurable via Helm, so known-broken clients can be dropped without rebuilding the image.
Networked verbs opt into the gate; `dam version` is the un-gated informational counterpart that surfaces the same verdict but always exits 0.
It also compares the CLI with the `latest` CLI on npm, which catches an old CLI against a server built from `main`.
`dam version --json` prints the versions, the verdict, whether the CLI is behind npm's `latest`, and one `upToDate` answer.
A field it could not learn is `null`, with the reason beside it; `upToDate` is `null` when neither npm nor a recommended CLI could tell.

## Authentication

`dam auth login` authenticates against the active host's Keycloak realm ([security-and-credentials.md](security-and-credentials.md)) via the OAuth 2.0 Device Authorization Grant ([RFC 8628](https://datatracker.ietf.org/doc/html/rfc8628)).
The realm advertises a public `platform-cli` client (device grant only, no secret); the CLI discovers its id from the server rather than hardcoding it, then drives the standard device flow — print (and optionally open) a verification URL, poll the token endpoint — and on success persists a per-host credential record under `$XDG_STATE_HOME/dam/` with restrictive permissions and an atomic write.
A user who refuses the grant in the browser ends the poll with `access_denied`: login exits non-zero, says the user refused the sign-in, and saves nothing.

Credentials are keyed by host URL, so switching between deployments never clobbers state.
A host that moved redirects its `/api/auth/config` to the new host; login follows that redirect, keys the credential under the new host, and saves the new host as the active one.
Host URLs are normalised wherever they are saved or compared (a lower-case origin, no trailing slash), so a host matches however its URL is written.
`dam auth status` lists each host, credential source, session state, and token expiry, and never prints tokens; `--json` gives the same as data.
`dam auth switch <server>` makes a saved host the active one by writing it to the config file, with no new sign-in; it finds the host by its URL or its host name, and refuses one with no saved credential.
Login, status, and switch judge a saved credential the way every other verb does: through the `TokenProvider`'s saved-credential path, which refreshes a lapsed access token.
A credential that refreshes counts as a valid sign-in, and login asks for confirmation (or `--force` without a terminal) before it replaces one.
A credential whose refresh fails with an invalid grant is expired: status marks it so and exits non-zero, and login replaces it without `--force`.
Status checks every saved host, one after another, and keeps an expired credential listed, so a user can still switch to that host and sign in there again.
When the refresh cannot reach the IdP, status says it could not check, and login goes ahead rather than refuse on a session it cannot show to work.
`dam auth logout` best-effort revokes the refresh token ([RFC 7009](https://datatracker.ietf.org/doc/html/rfc7009)) and removes the local entry; the local clear always proceeds even when revocation fails.
Logout is deliberately not RP-Initiated Logout — the CLI must not kill SSO sessions belonging to the web UI or federated apps.

The `auth` module exposes one seam — **`TokenProvider`** — that every authenticated verb consumes.
Its precedence: the `DAM_TOKEN` env var (used verbatim, never refreshed) > the stored per-host credential (refreshed proactively near expiry, with rotated refresh tokens persisted) > a not-logged-in error.
A refresh that fails with an invalid grant clears the entry and surfaces a session-expired signal directing the user back to `dam auth login`.

Those are the client-side signals.
The server can also reject a request that looked valid locally, and the CLI surfaces that distinctly rather than as a transport failure: it maps the api-server's raw 401/403 (alongside the existing 412 Terms gate) to typed errors.
A 401 becomes session-expired — with a hint that switches to "check `DAM_TOKEN`" when that variable is set, because a bearer supplied that way lives outside the credential store and re-login can't fix it.
A 401 that answers after a redirect to another host names the move instead, because `fetch` drops the bearer on a cross-origin redirect; the CLI never resends the bearer to the redirect target, since that host was never logged in to.
A 403 becomes access-denied with no login hint: the caller is authenticated but not authorized (e.g. an account without the install's required realm role), so the remedy is an admin, not re-authentication.
Any other reached-but-rejected request surfaces the server's own reason; "cannot reach server" is reserved for genuine connectivity failures.
An error answer that is not JSON — a gateway's HTML page — names the HTTP status it came with, never a parse error.
The 412 Terms gate's remedy is now `dam terms accept` (see the `terms` group), so a headless/CI caller can review and clear the gate entirely from the CLI with no browser.

For headless / CI use, `DAM_TOKEN=<bearer>` is used verbatim and bypasses the credential store.
It accepts either a Keycloak access token or a Platform **API key** (`pk_…` prefix); the CLI does not branch — the server's bearer middleware dispatches by prefix.
There is no `--token` flag, to keep tokens out of shell history and `ps`.

**API keys** (`dam auth token`) mint, list, and revoke long-lived keys scoped to a set of capabilities and optionally bound to specific agents.
A created key's plaintext is returned once and printed to stderr (so a `>` redirect doesn't silently capture it) unless `--json` requests it on stdout.
API-key principals cannot mint further keys — the server enforces that, so the constraint holds regardless of how the CLI is driven.
Concurrent writes to the credential store are not coordinated in v1 (a solo, single-terminal assumption): overlapping processes can each persist their own merged snapshot, at worst forcing one re-login.

## Agent addressing

The `agent` module gives users a human-friendly way to name an Agent and exports the seam every Agent-targeted verb consumes.

- **Agent Ref** — what the user types: either an Agent ID (`agent-` followed by 16 hex characters) or an Agent name.
  The split is syntactic; no probe disambiguates them.
- **Resolver policy** — a ref with the ID shape is fetched by id; anything else is matched by exact, case-sensitive name.
  Zero matches is not-found, one is ok, two or more is ambiguous.
  No normalization, no retries, one round-trip.
- **Reserved ID shape** — the api-server mints Agent IDs as `agent-` plus 16 hex characters and rejects Agent names of that exact shape at create and rename, eliminating the only ambiguous case.
  A name such as `agent-2` is allowed.
- **Uniqueness** — `(owner, name)` is unique, enforced at create and rename with a CONFLICT error; an agent that already shares its name may keep it.
  The narrow race window is accepted for CLI traffic and falls through to the resolver's ambiguous path.
- **`resolveAgent`** is the seam every downstream verb resolves through, via one shared resolve-or-exit step that reports a not-found or ambiguous ref uniformly; the verb then binds an agent-scoped client to the resolved active host.

## Command surface

The CLI is at parity with the web UI across these groups.
Each concept's depth lives on its owning architecture page; per-verb flags, exit-code numbers, and tRPC procedure names live in the code, not here.

- **`auth`** — login, logout, status, and API-key management ([Authentication](#authentication)).
- **`update`** (`upgrade` alias) — update the documented global npm installation to the latest stable CLI release, or report that it is current.
- **`agent`** — list, get, create, interactive create, update, models, avatars, delete, restart, disable, enable, plus read-only template listing ([Agent lifecycle](#agent-lifecycle)).
- **`chat`** / **`session`** — attach a local terminal to a running agent's TUI, and list an agent's sessions ([Terminal attach](#terminal-attach)).
- **`telemetry`** — list a session's turns with the Metered Spend of each ([Spend limits](spend-limits.md#ledger)), and export its traces and log records as newline-delimited JSON ([Agent telemetry](agent-telemetry.md)).
- **`metrics`** — an agent's measured spend by model and by session, and its recent calls ([Metrics](metrics.md), [Spend limits](spend-limits.md#ledger)).
- **`run`** — headless programmatic runs for CI and orchestration: submit a prompt, stream the answer, read a finished run's result later, cancel a running one ([Headless runs](#headless-runs)).
- **`ssh`** — a login shell, SCP/SFTP, port-forwarding, and editor Remote-SSH into an agent ([SSH access](#ssh-access)).
- **`import`** / **`file`** — bulk upload and granular file get/put/list into an agent workspace ([Files and import](#files-and-import)).
- **`network`** — per-agent egress pre-approval rules; **`approval`** — the HITL queue of prompts that did appear.
  Both owned by [security-and-credentials.md](security-and-credentials.md).
- **`connection`** — stored credentials and MCP contributions an agent uses, owned by [connections.md](connections.md).
- **`channel`** — Slack channel bindings, owned by [channels.md](channels.md).
  Slack connect binds a channel (optionally ambient-on); the channel listing shows each binding's ambient state.
  An ambient connect against a server that doesn't understand ambient fails loud rather than silently landing mentions-only.
  Telegram binds in-chat (`/bind`), so it has no CLI verb.
- **`skill`** — git-based skill sources, install/uninstall, and publish, owned by [skills.md](skills.md).
- **`satellite`** *(experimental)* — expose this machine's tools and manage the ones an account has, owned by [satellites.md](satellites.md).
  `mcp` and `shell` are the two verbs with no browser counterpart: each is the worker itself, and its log is how a user reads what the machine accepted, refused and ran.
  The group marks itself experimental in its description and help text, which is how a pre-release surface is disclosed where there is no feature flag to read.
- **`schedule`** — time-triggered tasks on an agent: recurrences, including the Precheck that decides each occurrence, and one-time schedules at a local moment or now, owned by [schedules.md](schedules.md).
- **`spend`** — the Metered Spend per UTC day, today's spend against the Spend Limits and the caller's Spend Ceiling, for one agent or for the caller, and setting or removing a daily limit for an agent, for all of the caller's agents, or for an agent's calls on one Connection in that Connection's unit; for a platform operator, also listing, setting and removing each user's Spend Ceiling by the user's email; owned by [spend-limits.md](spend-limits.md).
  "Continue" at a limit is an `approval` verb, because the question is an approval.
- **`budget`** — for a platform operator, listing each user's own compute Budget one page at a time (found, sorted and paged by the server), and setting, changing or removing one by the user's email; owned by [budgets.md](budgets.md#the-pool).
- **`terms`** — view the current Terms of Use and accept them from the CLI (`show` / `status` / `accept`), owned by the terms gate in [security-and-credentials.md](security-and-credentials.md).

## Shared conventions

Every command group is a thin client over the procedures its subsystem already exposes, holding no service state beyond a per-host client.
The recurring patterns, stated once:

- **Thin surface, server-authoritative.** The CLI does not re-validate domain rules it doesn't own; it sends the request and classifies the server's typed error, surfacing the server's reason for bad input, conflicts, and authorization failures.
  A few service boundaries convert plain errors to typed tRPC codes specifically so the CLI can classify them.
- **Exit-code registry.** Beyond generic success/failure, the CLI has a small set of named exit codes for machine callers (agent-not-resolved, invalid-input, rule- and schedule-not-found, agent-not-reachable, approval-not-actionable).
  Wrapper scripts branch on the code; the specific numbers are a code-level contract, not architecture.
- **`--json` parity.** Every read verb emits raw contract types under `--json` (an empty result is `[]`, never null); mutations emit a small result object.
  A very small number of verbs augment the raw shape where the annotation is the whole point of the flag — those departures are documented at the call site.
- **TTY discipline.** Destructive verbs confirm on a TTY, take `--yes` to bypass, and refuse on non-TTY without it.
  Interactive-only verbs (interactive create, masked secret prompts) refuse on non-TTY and point at the scripted path; a missing connection secret goes to the web page instead, which needs no TTY.
- **An agent that cannot start says why.** A call through an agent (`dam run`, `dam file`, `dam ssh`) that the api-server could not wake the agent for says so, with the server's sentence for the wake failure — the one the web app shows; `dam run` and `dam file` exit with the agent-not-reachable code.
  When no sentence comes back — the run relay closes its socket, or a gateway gives up on a slow wake and answers with its own page — the CLI reads the reason from the agent's state: the refusal of an agent waiting for room, or the error of a failed one.
- **Client-side ref resolution.** Agent refs resolve through `resolveAgent`; connection and skill-source refs generally resolve id-or-value against a team list before mutating, so a typo can't ride through a server-side no-op and report a false success.
- **Full-replace mutations are read-merge-write.** Where a server mutation replaces an entire set (agent grants, allow-lists, egress presets, a schedule's whole spec), the CLI reads the current value, overlays the change, and writes the whole set back, so the server re-derives the downstream effects for the correct final state.
- **Shared formatting and builders.** Where the CLI and UI must render or compute identically — egress-rule and approval-payload labels, the recurrence builder and its human-readable text — the logic is a React-free helper in the contract package that both consume, so the two can never drift.

## Agent skill

The repository ships agent skills for agents that run outside the platform ([`skills/`](../../skills/)).
They sit at the top level, not inside a client package, because a skill is not owned by any one client.
The repository's contributor skills ([`.agents/skills/`](../../.agents/skills/)) are for working on the repository, not for users.
Its [`skills-lock.json`](../../skills-lock.json) lists them, and a skills installer leaves out the skills that file lists, so an installer pointed at the repository offers only the skills in `skills/`.
A repository check fails when a contributor skill is missing from that list.
The `dam` skill teaches an agent on the user's own machine — any harness that loads skills — to drive a Platform deployment through the CLI.
The user installs it from the repository with an open skills installer, pinned to the release tag of the CLI they run.
The tag of a CLI from before the first release that ships the skill does not hold it, so the user updates the CLI first.

A deployment also serves the skill itself, so an agent given only its URL finds the CLI and the skill that matches that server.
The api-server image carries the `dam` skill of the commit it was built from, and the api-server lists it in an Agent Skills discovery index under `/.well-known/agent-skills/` (and the legacy `/.well-known/skills/`), with the digest of the file it serves, which an open skills installer pointed at the deployment's URL installs.
It answers `/llms.txt` too: what the deployment is, the CLI version it recommends, how to install the skill and sign in, and the rules on secrets and the API.
The web app's shell, which an agent's fetch reads without running its JavaScript, names the deployment in its title and points to `/llms.txt`, and the UI's web server answers 404 for any other `/.well-known/` path or root text file instead of the shell, so a file the deployment lacks does not look present.
The skill describes flows and rules, not every flag: the CLI's own help is its authority for flags.

The CLI's test suite checks the `dam` skill against the CLI.
It resolves every command the skill names against the CLI's command tree, every flag against the command it is given to, and the skill's exit-code table against the exit-code registry.
A CLI change that leaves the skill describing a command that no longer exists fails there, before it ships.

The `dam` skill extends the CLI's [trust boundary](#trust-boundary) to the agent that runs it: the agent never handles a credential.
Sign-in stays the device flow the user approves in a browser, and the agent never reads the credential store or the bearer variable.
A connection's credential, new or rotated, the agent never sees: it runs `connect` or `update` without the secret, the CLI opens the [secret-entry page](connections.md#connection) where the user types it, and waits for the outcome, as it waits for an OAuth sign-in.
Since the agent cannot check that secret itself, the outcome carries the server's [credential check](connections.md#connection) where the template has one, and `dam connection test` runs it again on the stored credential, so the agent can tell a broken token from a working one.
The CLI warns when a checked token expires within a day, and `dam connection list` shows each checked credential's expiry.
A GitHub App connection's check names the bot it acts as and the repositories it reaches, and `dam connection scope` reports the check of the new scope.
A GitHub sign-in or App installation is a parent no agent holds ([github-connections](github-connections.md)), and the CLI follows the UI there: `connect` ends in a connection made from it only with a scope or an explicit full access, and otherwise keeps the parent alone and shows what it reaches; `connect --from` adds another connection beside those it has; `list` shows each parent with its connections underneath and marks full access; and removing a parent first names its connections and the agents that lose them.
A name a parent shares with its first connection means the connection, so the agent's usual references keep naming what it holds.
The masked terminal prompt stays the fallback, for a user who prefers it or a server without the page; a command that takes it, and a new API key, which is printed once to whoever creates it, are handed to the user to run in a terminal of their own, and the agent then verifies the outcome with a read verb.
Approvals and Terms acceptance stay the user's decisions, which the agent relays rather than makes.

The agent reaches the deployment only through the CLI, never through the API directly.
A task the CLI cannot do is a gap in the CLI's parity with the web UI, closed in the CLI, not a reason to hand the agent a bearer.

## Agent lifecycle

The CLI presents Agents as single, atomic entities — one resource carrying both spec and runtime state, with no separate instance type.

- **Create** is one mutation; env vars and description attach to the payload and the merged Agent is provisioned atomically server-side.
  **Delete** removes the Agent, and the controller tears down its owned resources (the gateway StatefulSet, the Services and the NetworkPolicies) and deletes the machine and its disk, the same path the UI's delete uses.
  **Restart** stamps a restart revision; the controller restarts the machine on the current spec, and its disk survives.
  **Disable** puts the agent to sleep and keeps anything from waking it until **Enable**, which leaves it asleep until its next use ([agent-lifecycle](agent-lifecycle.md#disable)).
  `list` and `get` show a disabled agent's state as `disabled`.
- **Scripted create may name a model-provider Connection**, by id or unique name; without one the server grants one provider of the caller's that the harness runs on ([agent-lifecycle](agent-lifecycle.md#create)), and each session picks its harness and model.
  An id goes directly to creation with agent-management permission; name lookup additionally needs credential-read permission and rejects ambiguous matches.
  Before creating the Agent, the server checks that a named Connection belongs to the caller and is an active model provider, then includes it in the initial grants; an invalid one fails with guidance to choose or reconnect a provider.
- **Providers, harnesses and defaults** are the agent's Providers section: `get` shows the granted model-provider Connections, the harnesses the runtime reports carrying, the Session Pair defaults and the profile the chat default names ([harness configuration](harness-config.md)); `update` grants and revokes provider Connections, saves or clears a default and names a profile with `--profile`, through the same procedures the web app calls, so the server keeps every rule about which pair is valid; `--kind channel` and `--same-as-chat` still write the legacy channel pair that channels bound before profiles follow; `models` lists a harness's model catalog from the agent-runtime.
  An `update` flag changes only what it names: a new model keeps the default's harness and settings, a new harness drops the settings, since they belong to one harness.
  A part `get` may not read, such as the providers for a key without credential-read permission, shows as unknown and leaves the rest.
- **Name and avatar** are the identity the web app edits in place: `update --name` renames through the same procedure, with the server's name rules, and `--avatar`, `--avatar-file` and `--avatar-default` pick a character or an emoji, upload an image through the same endpoint and limits as the picker, or go back to the default ([agent avatars](agent-avatars.md)); `create` takes the avatar flags too.
  The CLI keeps the picker's rules: a character only once it is unlocked, an emoji or an image only with custom avatars on; `avatars` lists the characters, which are unlocked, and whether custom avatars are on.
- **`--wait`** on create and restart polls until the agent settles on running (success) or error (terminal), with a bounded timeout after which the agent is left as-is and the command exits non-zero.
  A refused start — the agent parked because its owner's pool is full ([budgets](budgets.md)) — also ends the wait: it names the refusal, says how to free room, and exits non-zero, leaving the agent parked.
  A refusal already standing before a restart counts only once the wait saw another state or a short grace passed, because the first poll can still read the previous attempt's denial.
  An error with no reconcile message prints the reason the controller reported, which is where a refused machine's text lands; a termination code the UI also treats as a refused start reads "could not start" rather than "entered error state", in both scripted and interactive create.
  A timeout prints the termination reason too, when the agent has one.
  Under `--json` every exit path still emits a valid Agent payload, so scripted callers never see empty stdout.
- **`dam agent create-interactive`** is the TTY-bound complement to scripted create: it walks name → template → model-provider connection → optional GitHub PAT and ends with the same agent and grants the UI's "Add agent" dialog produces, creating the Agent before applying its connection grants.
  Anything it creates during the run is tracked in a ledger and torn down in one cleanup pass on failure; what cleanup can't remove is reported as an orphan summary.
  The scripted `create` path stays the entry point for CI.

## Terminal attach

`dam chat <agent>` connects the local terminal to a running agent's interactive TUI over a WebSocket, using the same binary terminal-frame protocol as the UI's terminal mode.
It requires a TTY and puts stdin in raw mode so keystrokes — including Ctrl+C — pass through to the remote harness rather than being intercepted locally.
There is no detach key: as in the UI, closing the terminal is how the user leaves, and Ctrl+C stays the harness's interrupt.
Before it attaches, the CLI prints one line that says so, with the resume command to come back, and waits for Enter or five seconds so the line can be read before the harness's full-screen view covers it; `--no-pause` skips the wait, and Ctrl+C during it cancels the attach.
While attached, the window title carries the same hint and resume command: the bridge saves the user's title, sets its own, drops the title sequences the remote harness sends, and restores the saved title when it ends.

Session strategy is resolved **client-side**: sessions are agent-owned, so the CLI lists them over its own ACP connection to the api-server relay and resolves locally — mint a fresh id (new, the default), match the single most-recent terminal session (continue), or target a specific id (resume, prompting before a chat→terminal mode switch) — then builds the terminal-relay URL itself.
There is no server-side session endpoint.
A `--reset` flag tells the relay to kill the PTY and spawn a fresh one, which also clears the agent-side session.
The CLI sends no keepalive of its own: it answers the relay's 30-second ping ([sessions](sessions.md)), which keeps an attach open while the harness sits quiet.
Once pings have arrived, a connection that gets none for about two and a half intervals counts as lost, because a dead network path can leave the socket open with no error.
After a drop the CLI reconnects to the same session by itself, under the terminal reconnect rules ([sessions](sessions.md)).
While it reconnects, it resets the terminal's modes, shows a reconnecting notice with the reason and the attempt, and keeps stdin raw without sending it, so Ctrl+C stops the attempts.
Every attempt reads the token again, so an access token that expired during a long attach is refreshed, and a refresh that fails on the network is tried again with the next attempt.
The attempt targets the session the harness last moved its PTY to, and the screen is cleared just before the replay.
On exit, on a drop that does not reconnect, and when it gives up or the user stops it, the CLI prints a ready-to-paste resume command and the leave hint again.
`dam session list` reads the same agent-owned session list.
`dam session show` reads one Session: it lists the sessions first, so an id the agent does not have is refused with a pointer to `dam session list`, then loads it over the same ACP relay the UI uses and prints its Session Transcript as messages and tool calls.
A tool call's duration is the time between the stamps the runtime puts on the frame that started it and the frame that finished it, since no harness reports one.
The load answer says whether a turn is running and when it started, for any Session, so the CLI tells how long a turn has been going even where the run fields of the session list stay empty: those count unattended runs only.
`--follow` keeps the connection open and prints each new step and the turn's end as they come.

## Headless runs

`dam run <agent>` is the CI verb: it speaks ACP to the relay like the UI does — open a Session, submit one prompt, stream the assistant's text to stdout — and exits with a code derived from the turn's stop reason, so a pipeline can branch on the outcome.
Every run names its Session on stderr, so a caller continues the conversation with `--session` without searching `dam session list`; `--json` holds the answer back and prints one object instead, a finished run's session id, stop reason and text, or a *pending* one's session id, in the statuses `dam run get --json` uses.
The prompt comes from a flag or a file (`-` reads stdin — never implicitly, so a promptless invocation errors instead of hanging a CI job).
Sessions it creates are typed `cli_run` through the same session metadata every other surface uses — the UI groups them under their own category, and `dam session list` shows the type on each row; every prompt is stamped with a minted prompt identity and the CLI surface marker, so the runtime reports the prompt's fate, frames the turn as a direct one, and records the turn's outcome even when the prompt was sent into a Session another surface created.
Without `--harness`, `--model` or `--setting` it names no model: the relay fills in the agent's chat default ([harness configuration](harness-config.md)), so a run starts on the model the web chat would start on.
With them, `session/new` carries the choice as the web chat's picker sends it, and the session keeps its own choice instead of following the chat default; a session continued with `--session` keeps its own pair, so the flags are refused there.
A run refused for having no model adds the CLI commands that set one to the runtime's reason.

The headline property is that **the caller may leave**.
Detaching never cancels a running turn, so `--async` exits once the runtime reports the prompt started, printing the session id to poll with `dam run get`.
To make the result readable after the fact — the in-memory session log is reaped seconds after an unwatched turn ends, and harnesses differ in what they can replay — the agent-runtime records each finished `cli_run` run's outcome (prompt identity, stop reason, accumulated assistant text) in a **run record**, a size-capped document on the machine's own disk, deleted with the Session.
A run is done when its prompt is answered *and* the harness is idle: a harness that works on in an [Autonomous Turn](sessions.md#session-inside-the-machine), as Claude Code does when its background agents report after it answered, keeps the run pending, and the text of that turn joins the record.
The record then carries the run's final stop reason: the prompt's, or `cancelled` when `dam run cancel` stopped the Autonomous Turn; a harness that dies in it leaves a record with no stop reason, as a dropped turn does.
When the runtime writes the record it sends `platform/runEnded`, with the prompt identity and that stop reason, into the session log, and `dam run` and `run get --wait` end on it.
A runtime announces it with `_meta.platform.runEnded` in its `initialize` answer; against one that does not, `dam run` ends at the prompt answer as before.
A runtime-answered extension method serves it back as *done*, *pending* (turn still in flight — including one cut short by an abnormal death of the machine and awaiting its one automatic resume), *interrupted* (that resume was cut short too, so the runtime will never finish the run — `dam run` reports it as failed with a retry hint), or *none*; a turn the harness dropped mid-run is recorded with no stop reason rather than erased, so a lost run never reads as one that never existed.
`dam run get` prints it — under `--json`, the extension method's own status-discriminated payload verbatim, a *pending* shape on wait expiry so stdout is never empty — `--wait` attaches until the run ends, and `dam run cancel` cancels only a run it could positively read as pending.
The record lives in the agent's home volume and shares its lifetime — [persistence](persistence.md) owns what that survives; durability beyond the agent is a deliberate non-goal for now.

The same record is the disconnect story: a `dam run` that loses its socket mid-turn reconnects with backoff, re-loads the Session, and finishes from the record — matching its own turn by the prompt identity and stop reason the logged end-of-turn signal carries — printing only the text it has not already streamed; the total wait is always bounded — `--timeout`, one hour by default (the `agent create --wait` convention) — and on expiry the command exits non-zero with the session id still printed, leaving the run resumable.
Permission requests are never answered — a headless auto-deny would also deny the egress approvals the platform injects as synthetic permission requests — the CLI prints a stall line naming the approval and the `dam approval` command that clears it — once per approval on each connection, however often a retrying request raises its prompt again — and the request is already mirrored into the approvals queue where the UI or `dam approval` resolves it out-of-band.
That patience has a bound the caller should know: an attached `dam run` keeps the request open until its own timeout, but a detached run (`--async`, or after `run` exits) leaves the request with no engaged channel.
The runtime then reports it to the api-server at once, so it waits on Home, in the approvals bell and in `dam approval` with the time the agent asked, and a verdict given there answers it while the run stays detached ([sessions](sessions.md)).
Only a request nobody answers within the runtime's ten-minute wait is dropped — the tool call fails with an error, its approval expires, and the turn runs on to a recorded outcome — so an unattended run stalls for minutes, not forever, and loses that one tool call only when nobody answers in time.

## SSH access

`dam ssh connect <agent>` drops into a plain login shell in the agent's workspace and supports everything real SSH does — `scp`, `sftp`, port-forwarding, and editor Remote-SSH.
Where `dam chat` attaches to the harness TUI, SSH gives a bare shell.
The session inherits the agent's environment — the egress proxy, credential sentinels, and `PATH` — so `git`, `gh`, and the AI CLIs work exactly as they do for the harness (the agent-runtime replays the live injected env per connection; without it even DNS fails, since egress is proxy-only).
sshd refuses to start a session whose environment exceeds 1000 entries, so the replayed file is capped just under that and sheds Kubernetes service-link vars first — a machine carrying hundreds of them still gets a shell, with its credentials and proxy intact.

The transport is an OpenSSH `sshd` inside the agent, spawned per connection and tunneled over the agent WebSocket; the SSH wire protocol is opaque to the CLI and api-server, which relay bytes verbatim.
SSH terminates at that sshd, which reuses the same upgrade auth (token → ownership → terms) as `dam chat`.
Authentication to sshd is public-key via a dedicated dam keypair under `$XDG_STATE_HOME/dam/` — the user's real identity is the bearer token verified at the WebSocket upgrade, and the SSH key is only the transport credential.
Host-key checking is disabled deliberately: the TLS-encrypted upgrade is the real trust boundary, so the agent's host key authenticates nothing extra, and it is no loss that a fresh host key comes with each boot.

Arguments after `--` go to `ssh` verbatim, after the agent host, so `dam ssh connect <agent> -- -L 8080:localhost:8080 -N` forwards a port without a shell and `-- uname -a` runs a remote command; editor modes reject them.
A single `--exec` flag selects the client and how it is invoked (`ssh`, or an editor in `code`/`zed` mode).
Editor modes write a managed host block to dam's own ssh_config and pull it into `~/.ssh/config` via one `Include` line — the reliable cross-client hook, since editors are often already-running singletons that ignore a launch-time environment — then launch the editor against the agent alias; `dam ssh configure` writes those blocks without launching and can reconcile them to the host's current agents or clear them.
`code` mode additionally pre-allows the VS Code server-download hosts as egress rules so the connect doesn't trip a mid-flight approval prompt.
`dam ssh` depends on the OpenSSH client locally; `sshd` ships in the shared agent base image, so every agent supports it.
The files sshd needs to let a connection in — its host key, its config and the keys a connection registers — are in a directory of the runtime's own, `/run/dam/ssh`, and not in the agent's home, so a full agent is still one its owner can get into to free it; the environment file stays where sshd reads it, in the home, so that session starts with a bare shell and without the replayed environment.

## Files and import

`dam import <agent> <path…>` bulk-uploads files or folders into the agent's workspace.
It builds a single gzipped tar — skipping symlinks and a shared exclusion set (`node_modules`, `.venv`, …) — and POSTs it as multipart to the same import endpoint the UI targets.
Folders are merged recursively: files are added or replaced, existing files not in the bundle are kept.
The runtime rejects bundle files that collide with existing directories before merging; the CLI reports the conflicting paths.
It confirms on a TTY before proceeding.

`dam file get/put/list` are the granular, non-destructive counterparts over the same per-agent file surface the UI's file browser uses, reusing the shared token, compatibility, and resolver seams.
Listing can cover one directory or recursively walk the workspace or a subtree, batching directories at each depth within the API’s path-count limit and splitting multi-directory requests by encoded input size to fit the HTTP URL limit.
A directory path that exceeds the request budget on its own fails locally before its request is sent.
Output names every entry of a listed directory as a workspace-relative path — files and directories alike, with directories distinguished by a trailing separator, so a user can see which subfolders exist to descend into; recursive output is sorted by path.
A symlinked directory is listed but not descended into, so a link to an ancestor cannot loop the walk.
A failed directory read fails the command rather than returning a partial listing as complete.
Listing includes dependency directories such as `node_modules`; the server hides only reserved paths and import-staging entries.
Import exclusions belong to the import bundle builder.
Per-file size caps are enforced server-side; the CLI surfaces the server's too-large error rather than duplicating the constant.
Neither verb group introduces a service layer — wire calls are classified inline.
Recursive download, large-file streaming, and rm/mv/mkdir are out of scope until a concrete use case appears.
