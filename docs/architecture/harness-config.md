# Harness configuration

Last verified: 2026-10-14

## Overview

How an owner's mode and config-defaults choices for each harness an agent carries — or a driver's, for an agent it spawns — reach that harness's own configuration file, where the model list behind those choices comes from, and what the Config panel shows while the agent is stopped.

The choices travel as a `harness-config` Event over the [runtime channel](runtime-delivery.md) — that page owns delivery and capability gating; this one owns what the event means and everything built on it.

These are each harness's defaults: writing them recycles only the [Harness Leases](sessions.md#session-inside-the-pod) of that harness.
The model is not among them: each session picks its harness, provider and model, so the Config panel shows the settings of every carried harness and no model setting.
Every harness gets its model as a lease's environment, which its scripts honour over the config file and a provider pin; a session's model is never switched inside a live harness, because a resumed session would fall back to the file's default.
The runtime advertises its default harness and, per carried harness, the catalog.
The model list a session or a [schedule](schedules.md#session-model) picks from is asked per harness and provider over the runtime's tRPC, without spawning anything — the discovered one where the provider lists its own.
The session picker offers named models, not a generic default-model choice.
It shows loading, unavailable and empty listings explicitly, with a retry for failed discovery; a failed listing never falls back to the harness's static catalog.
The catalog remains usable where discovery is not configured.
Before a session starts, the picker lists every provider the harness accepts in one stable order: an attached provider shows its models and a disconnect action, and one not attached offers to attach it, so a provider never carries another provider's model.
It grays out a harness that no provider the owner holds accepts.
With no provider at all, the chat opens the provider list in a modal, and the picker's place holds a link that reopens it.
A provider connected in that modal is granted to the agent whose chat opened it; an edit of a connected provider grants nothing.
Until the agent has reported the harnesses it carries, as a new agent has not before it first answers, the picker shows the pair a new session is expected to run on, from the Agent's own harness, its granted providers and the harness catalog: the pair picked for the next session, else the remembered pair when it names that harness, otherwise the harness on the first granted provider it accepts, with its default model.
Opened then, it shows a loader until the list arrives, and a session started meanwhile names its pair only after the harnesses and the remembered pair are read again.
Until the harness catalog arrives, the picker label is a loader, never a raw harness name.
A session the UI starts holds the pair it sent as its own view until the agent lists the session, so the composer names that pair from the first moment.
While a sleeping agent wakes, the picker shows each provider's models as loading rather than asking for a start.
In an existing session, the picker shows its harness and only its active provider's models: another harness or provider needs a new session, which the picker links to, and context moves over only through a file the agent saves.

## Session settings

A session may also pick the settings its harness manifest lists under `sessionSettings`: mode, effort, thinking level, prompt cache or approvals, each a catalog option.
The choice belongs to that session alone and starts with its next turn; it is kept in the runtime's session metadata beside the [Session Pair](../ubiquitous-language.md), and `_platform/session/configure` changes it.
Only **Set as default** on a running session, or the default harness, provider and model picker on the agent's Providers page, saves the pair as the agent's remembered pair, which preselects the next session and is what schedules and channel turns run on; starting a session saves nothing.
With none saved, the remembered pair is the agent's own harness on the first granted provider it accepts: the default harness its runtime reports, or, before the agent's first `hello`, the Agent's own harness, and the catalog's default only when the Agent names none.
Each binding says how the harness takes the value.
A session-scoped one (`mode`, `configOption`) is sent as ACP `session/set_mode` or `session/set_config_option` to that session only, never by recycling a harness other sessions share.
The runtime sends it again whenever the session is loaded or resumed into a harness process.
A setting always holds a value: the picker starts on the agent's configured value for the harness, or the manifest's `default` for the option where nothing is configured, and offers no unset choice, so a change always names a value the harness applies.
A mode the harness changes on its own, as plan mode handing over to implementation does, becomes the session's saved mode.
A change made mid-turn waits for the turn to end, and the next prompt waits for the harness to answer the change.
A process-scoped one (`env`) is a value the harness reads only at start, such as Claude Code's prompt-cache TTL or Bob's approvals flag; it joins the Harness Lease key, so the session moves to a process started with it and the other sessions' process is left alone.
Such a move is refused while the session's turn runs.
Bob reads one settings file under its home and watches it, so each Bob lease points that file at a copy of its own through a preload.
Only Bob itself runs with the preload: its bootstrap reads the agent-wide choices from the shared file and writes the copy.
The task store, rules and MCP configuration under `~/.bob` stay shared.
A runtime without the `sessionSettings` capability keeps the Config panel's harness defaults instead.

An unreadable setting is unavailable, not an unset default.
Pi receives its selected provider and model as command-line options, because its extension loads after startup settings have been read; updating the saved defaults alone would leave the first turn on an earlier provider.
A runtime with a harness that has a harness config but no `sessionSettings` predates per-session routing: its harnesses ignore a lease's model, and Pi then falls back to its built-in Anthropic default.
For such an agent the chat shows an update notice instead of the picker, and new sessions, schedule fires and channel turns name no Session Pair, so they run on the agent's defaults.

## Provider compatibility

Provider compatibility follows the configured harness catalog, shared by the settings view and session selection.
It also follows the [Connection](connections.md)'s credential mode: an Anthropic API key works with Claude Code and Pi, but a subscription OAuth Connection is offered only to Claude Code.
Automatic provider selection and scheduled or channel-driven turns apply the same restriction.
A provider speaking another harness's API dialect is not enough: the Connection must also supply that harness's authentication and endpoint configuration.

## The event

`harness-config` is the mode/config-defaults mechanism: a user action in the Config panel fires one event, naming the harness it is for — the api-server refuses one the agent's runtime does not report carrying, and an event naming none means the default harness — and the agent-runtime writes the mapped keys into that harness's own config file once, and — like `workspace-seed` — never re-asserts, so the file stays the user's to edit (a hand-edit via the Files panel or SSH is never reconciled away).
Because a harness reads that file only when it spawns, a write is followed by a recycle: idle, the process goes at once; mid-turn, after the work drains, on the same deferral the env rail uses, which a kept [Harness Task](agent-processes.md#reported-background-work) holds back until it ends.
Without it a declared value would sit unread until something else happened to restart the harness, which is the shape of a setting that silently does nothing.
A spawn is the second producer: a driver may name its child's choices, and the platform queues them ahead of the child's first turn, so that turn already runs on them.
No person acts there, so it records neither an activity nor a declared snapshot.
A write that fails is reported back rather than only logged in the pod, and for a spawned child that report fails the spawn, since the turn behind it would otherwise run on the default.
The Config panel is driven entirely outbound, not over an ACP session: every carried harness's manifest declares its own `harness-config` driver entry, the runtime running one per harness, carrying both the field → file-keyPath mapping — a config option may name several key paths, which one choice writes and unsets together and the first of which is read back as its value, so a harness keeping one setting under two keys (Claude Code's prompt-cache TTL for the conversation and for its subagents) still offers one choice — and an option **catalog** (the available model/mode/config choices and their per-model validity), and the agent advertises that catalog on `hello` (alongside a `harnessConfig` capability flag) for the api-server to serve to the UI; the *current* values are read back live from the config file via the agent-runtime `harnessConfig.current` query.
A manifest may instead declare a `modelDiscovery` source, in which case that same read fills the model list live from the provider rather than from the static catalog — or, for a source marked as extending it, after the catalog's own models, for a harness whose catalog means something on every provider.
A source is declared against the env rail: it names, in priority order, the variables a granted connection materializes the provider's base URL into, so *which* endpoint is asked follows from what the agent was granted, and it says which model-listing dialect that provider speaks.
The order carries weight because an agent can hold several connections at once and the rail settles a name claimed twice by an order nobody chose, so a connection that redirects the harness and one that merely supplies the harness's own endpoint contribute different variables and let the source rank them.
To be usable a provider has to answer such a listing over the agent's normal egress and let a conversational model be told apart from the rest of what it fronts; nothing else about it matters, and because the request leaves the pod through the credential-injecting gateway like any other, discovery authenticates with the injected credential rather than one the agent holds.
The source names the variables that hold the connection's credential placeholder, and the listing carries it as a harness request would: a gateway that injects only addressed requests learns the connection from it, and one that injects every request replaces it.
Once the env rail has materialized, no connection supplying a URL means the agent has no provider to list, so the read reports no list at all and one an earlier provider established is cleared rather than left offering models the agent can no longer reach; before that first materialization a missing URL says nothing about the grant.
A source may also name a second listing on the same endpoint, asked only when the provider refuses the first: a LiteLLM key can be barred from the model-information route yet allowed the OpenAI model list, which says nothing of what a model is for, so there only the name keeps an embedding model out.
A provider that refuses every listing or cannot be reached and a listing with no conversational model in it are one outcome — *unavailable* — which leaves whatever list was last established in place and never fails the read; the first read of a pod's life pays DNS and a TLS handshake before any of that, so it is retried once rather than being written off on a merely slow cold path.
The runtime keeps the last list each provider endpoint gave a harness, in memory and on the agent's home volume, and answers the model list and the current-values read from it at once, asking the provider again behind the answer, so a slow listing through the gateway never holds the picker or the defaults label.
When that listing changes a kept list, a watch on the runtime's harness-config surface tells each open chat and agent settings view to read the model lists and current values again; the notice carries no payload, and every subscription opens with one, so a reconnect heals by re-reading.
A runtime that predates the watch leaves the next read to see what the listing found.
Reads that overlap share one listing.
With no kept list, on the first read for an endpoint, the read waits for the listing.
The seed and a lease's model never answer from the kept list: they ask the provider, and what it answers refreshes the list.
A kept list can offer a model the provider has since retired.
On Claude Code a name the gateway published for a tier, or one naming a tier, then goes to that tier's current model.
Any other name reaches the provider unchanged, so a model the provider serves without listing it still runs.
When the provider refuses a name it does not list, and its refusal names that model, Claude Code's gateway sends the turn again on the model its opus tier maps to, Claude Code's default, and logs the remap; on other harnesses the turn reports the refusal.
An existing session's label marks a model its provider no longer lists, so a turn that runs on another model than the pick never does so unseen.
Which choices a harness offers is its catalog's to say: Codex's offers no mode, because its image runs it never asking for approval, so there is no permission mode to pick and nothing for a [channel turn](channel-turns.md) to refuse.

## Model discovery and the seeded model

A discovery source is also what lets a **seeded model** exist, and it is the one write to that file no user action is behind.
A harness pointed at somebody else's provider cannot rely on its own built-in default: the model it would name need not exist upstream, and a listing that does not know it refuses the turn outright rather than substituting anything — so an agent nobody has configured yet fails its very first prompt.
The seed closes that: with nothing set and nothing pinned on the provider, agent-runtime writes the first of the discovered names — the list is ordered, so the pick is stable rather than whatever the provider happened to return first — before the default lease's harness spawns: at boot, and again before the spawn that follows an env change, since a provider switch reaches the pod as one.
The boot gate holds early callers until it lands under a ceiling of its own, five seconds, well short of the env's, because the caller held is usually a person opening a chat; a listing that cannot be reached is asked again for a while first, because the gateway fronting a newly granted provider is still rolling when its env lands.
Only a spawn with no model to stand on waits for it.
When the file names a model, or the provider pins one, and the provider has not changed since that model was last checked, the harness starts on it at once and the listing runs after the spawn, so a wake and a past session's history never wait for a listing through a gateway pod that has only just started.
That check corrects the file the same way the seed would, and the write recycles the harness like any other config write: at once when idle, after the work drains otherwise; a turn sent in between runs on the old model and gets the provider's own refusal.
A boot counts as checked against the provider the agent had before it slept; a provider switch while running is not, so the spawn that follows it waits for the new provider's listing.
It never speaks over a value somebody chose that the provider lists: a hand-edit the listing knows stays, and a session that picks its model never needs the seed, and with nothing in the file a provider pin the listing knows is the default.
A model the listing does not know — in the file, or pinned by a connection whose catalogue has moved on — is not left to fail every turn: a file model is cleared when the provider lists the pin, and otherwise the first listed name takes its place, which is how a model chosen on one provider does not outlive a switch to another and a retired pin does not stop an agent.
Between a pin and the file, the file wins: a connection's model pin is only a default, checked against the live listing each time it would apply, and a model in the file that the provider offers outranks it, so a choice is never silently overridden by the connection it rides on.
Whether a source justifies it follows from *which* variable supplied the URL, which is why the manifest marks the redirecting ones apart from those that merely carry the harness's own endpoint: on its own provider the harness's default is the better answer and stays untouched.
An unavailable listing seeds nothing, so a harness whose provider cannot be reached keeps the behavior it had — the seed can pick a model, not invent one.
Only harnesses whose manifest declares the `harness-config` driver honor the event and advertise the capability that gates the UI section; a spawn that names choices for a child without it, or names a setting the child's catalog does not offer, fails rather than letting the child run on its default.

Bedrock is the third dialect, after the OpenAI model list and LiteLLM's model info.
The [AWS Bedrock](connections.md#app-preset-aws-bedrock) Connection names the region's control-plane endpoint, and Pi's manifest declares it as a source ahead of its OpenAI one, speaking Bedrock's inference-profile listing — the profiles that can be invoked from that region, each carrying a region prefix a bare model ID lacks, which is why a typed ID is the wrong unit to offer.
Models Bedrock also serves on demand under their bare ID are not in that listing, so they are not offered either; the Anthropic models a coding harness runs on are reachable only through a profile.
A manifest lists its sources in priority order and the first whose variable is set answers, so one harness fronts several providers' dialects without a static catalog.
The seed and the provider pin behave exactly as for an OpenAI-shaped provider.
What no listing can say is whether the account has been granted a model: that is learned at the first call, as an error the turn reports.
Claude Code's catalog is model tiers, which Claude Code itself resolves to the region's Bedrock profiles ([connections](connections.md#app-preset-aws-bedrock)), so its source asks only the LiteLLM-shaped endpoint a connection points it at, and extends the tiers rather than replacing them.
There its in-pod model gateway defaults every tier to the newest model the provider has for it, which on a provider that serves no Claude model is one model for all of them unless the Connection pins the slots; the provider's other models are reachable only by name, so the panel lists them after the tiers, under the lowercased, `claude/`-prefixed names the gateway publishes to Claude Code itself, so a choice made in the panel and one made in Claude Code's own model picker are the same value.
Nothing is seeded: the tiers already resolve on any provider.
Claude Code reads its tier models only at start, from the gateway, so the gateway keeps the last list each provider gave it on the agent's home volume and answers from that list at once on the next start, refreshing it from the provider afterwards.
A name it gave Claude Code for a tier that the provider has since retired goes to that tier's current model, so a kept list that is out of date costs nothing.
With no kept list, on the agent's first start or a new provider, the gateway does not wait for the listing: it listens at once and gives Claude Code its own tier names, `claude/opus` and the like, which each request maps to that tier's model once the listing is in, the request waiting for it.
Claude Code knows those names no better than a provider's own, so it sizes the request as for any model it does not know; the next start gets the listed names.
A provider that never lists then receives the bare tier name and refuses the turn.

CurveBender pins Claude Code's Sonnet slot to its non-reasoning Nemotron model for the auto-permission classifier, and every work slot and the default conversation to GLM.
It also turns off the server-side auto-mode check: GLM cannot answer the classifier's non-thinking request within its deadline, so the model pin and that flag are needed together.
The Connection disables unsupported tool search and declares the deployment's supported context window.
These are provider-scoped defaults, not a change of permission mode; a session's model and explicit agent settings still take precedence.
Its model listing remains the upstream catalog, so Nemotron can still be selected explicitly but is not a work-model default.

The ETE LiteLLM proxy cannot carry the classifier reliably: its failed classifier requests deny tool calls that are safe.
So when an agent holds that provider, every Claude Code start changes an agent mode of `auto`, or no mode, to `bypassPermissions`.
Other modes stay, and so does a mode that one session picks for itself.
The pod's isolation is the boundary then, also for what channel members ask a bound agent to do.

The runtime also reports the harness's **default**, what a session runs on when the config file names no model: a model the provider pins through its environment, otherwise a manifest-declared value that selects the harness's built-in default for one session.
Only a harness that can switch a session's model reports one.
A [schedule](schedules.md#session-model) with no model runs on it on a runtime with one harness process; where each session picks its harness, it runs on the pair a person last picked.

## Snapshots

Because the live read needs a running pod, the platform also keeps a **snapshot** of these values, so the Config panel renders the last known configuration while the agent is stopped.
An apply records what it *declared*; a snapshot is display state and is never re-asserted onto the harness, so the harness's own file stays authoritative and the live read wins whenever the agent is up.
A snapshot always carries the moment it was captured, and whether a pod has confirmed it or it is merely what an apply asserted — the distinction matters precisely because the event never re-asserts, so a hand-edit can move the file out from under a declared value.
Snapshots are kept per harness, and the pod reports each carried harness's values at two points, and the split is forced: on `hello` it reports the files' values alone, since a clean boot with nothing pending never applies and a hand-edit would otherwise go unseen for that whole run; the apply reply reports those plus the discovered model list, which can only be resolved once the env driver has materialized the provider's base URL.
A report omits the model list when it could not be resolved, so a failed read never erases one an earlier read established; a harness with no discovery source, or no provider for one, records that fact instead.
