# Harness configuration

Last verified: 2026-10-20

## Overview

How an owner's mode and config-defaults choices for each harness an agent carries — or a driver's, for an agent it spawns — reach that harness's own configuration file, where the model list behind those choices comes from, and what the Config panel shows while the agent is stopped.

The choices travel as a `harness-config` Event over the [runtime channel](runtime-delivery.md) — that page owns delivery and capability gating; this one owns what the event means and everything built on it.

These are each harness's defaults: writing them recycles only the [Harness Leases](sessions.md#session-inside-the-pod) of that harness.
The model is not among them: each session picks its harness and, per turn, its model, so the Config panel shows the settings of every carried harness and no model setting.
The runtime applies a session's model inside the live harness through its own per-session call before each prompt and after every cold load ([agent-lifecycle](sessions.md#session-inside-the-pod)), and the [Model Router](#the-model-router) routes every call by that name.
The runtime advertises its default harness and, per carried harness, the catalog.
The model list a session or a [schedule](schedules.md#session-choices) picks from is asked per harness and provider over the runtime's tRPC, without spawning anything: the discovered one where the provider lists its own.
The session picker offers named models, not a generic default-model choice.
It shows loading, unavailable and empty listings explicitly, with a retry for failed discovery; a failed listing never falls back to the harness's static catalog.
The catalog remains usable where discovery is not configured.
Before a session starts, the picker lists every provider the harness accepts in one stable order: an attached provider shows its models and a disconnect action, and one not attached offers to attach it, so a provider never carries another provider's model.
It grays out a harness that no provider the owner holds accepts.
A web terminal starts from a row of harness buttons on the agent's General page: a button stores its harness, with the first attached provider it accepts, as the next session pair, and the terminal sends that pair when it connects.
The empty chat's Browser Terminal card opens a web terminal on the pair the session picker holds.
With the new layout on, the empty chat shows the General page's harness buttons in a Web terminal row instead of that card.
A harness that only providers the owner holds but has not attached accept opens the attach dialog, then opens on the provider attached; a harness no provider the owner holds accepts is grayed, and its tooltip names the harness and says why.
The attach dialog, from the picker or a harness button, lists only the owner's unattached providers the harness accepts and the agent can take, leaving out one of a kind the agent already holds, each as the agent's Providers page shows it, with the harnesses it runs.
Its rows start switched off, except the provider the owner clicked in the picker; nothing is attached until at least one is on and the owner confirms.
An agent holds one provider of a kind, so switching a row on locks the other rows of its kind.
The UI names a provider by its Settings name, such as Bob Shell, not the connection's own name.
With no provider at all, the chat opens the provider list in a modal.
While the agent holds no provider, the chat blocks sending, and the picker's place holds a link to that modal; a provider connected or picked there is attached to the agent.
With no pair picked or remembered, the picker preselects the default harness on the first granted provider it accepts, else the first carried harness a granted provider fits, with its default model.
Until the agent has reported the harnesses it carries, as a new agent has not before it first answers, the picker shows the pair a new session is expected to run on, from the Agent's own harness, its granted providers and the harness catalog: the pair picked for the next session, else the remembered pair when it names that harness, otherwise the harness on the first granted provider it accepts, with its default model.
Opened then, it shows a loader until the list arrives, and a session started meanwhile names its pair only after the harnesses and the remembered pair are read again.
Until the harness catalog arrives, the picker label is a loader, never a raw harness name.
A session the UI starts holds the pair it sent as its own view until the agent lists the session, so the composer names that pair from the first moment.
While a sleeping agent wakes, the picker shows each provider's models as loading rather than asking for a start.
In an existing session, the picker keeps its harness and, on a routed runtime, offers every granted provider's models: another harness needs a new session, which the picker links to, and context moves over only through a file the agent saves.

## Session settings

A session may also pick the settings its harness manifest lists under `sessionSettings`: mode, effort, thinking level, prompt cache or approvals, each a catalog option.
The choice belongs to that session alone and starts with its next turn; it is kept in the runtime's session metadata beside the [Session Pair](../ubiquitous-language.md), and `_platform/session/configure` changes it.
Only **Set as default** on a running session, the default harness, provider and model picker on the agent's Providers page, or the first model picked for a session, new or old, on an agent with no default model saves the pair as the agent's remembered pair, which preselects the next session and is what schedules and channel turns run on; starting a session saves nothing else.
With none saved, the remembered pair is the agent's own harness with no provider and no model: the default harness its runtime reports, or, before the agent's first `hello`, the Agent's own harness, and the catalog's default only when the Agent names none.
A saved pair with no model is a default that is **not set**; the platform never picks a provider or a model in the person's place.
On a routed runtime a default is saved only with a model: the Providers page shows "Not set" and offers no unset choice, a harness picked there waits for its model, and the picker of a new session or of a session with no model reads "Choose a model" and holds the prompt until one is picked.
On a routed runtime (`modelRouter` on hello) the saved model is a qualified name and its provider follows from it; a bare name, a provider the agent does not hold, or a model missing from the harness's last reported list is refused.
A run nobody picks for stays on the harness asked for, on the saved model and the provider it names; no saved model, or a model on a provider the agent no longer holds, fails the run as having no default model, with the reason, and no fitting provider fails it rather than moving it to another harness.
**Conversion of an old default.** An agent from before per-session defaults has no saved pair, and once it runs the Model Router the api-server converts its default once, from what is certain about it: its one granted provider that fits its harness, and the model setting that harness was left with, read against that provider's listing on the agent's own runtime.
A tier word (`opus`, `opus[1m]`) becomes the provider's newest model containing exactly that word, never another tier; a model id is kept when the provider lists it; the harness's own default becomes the model the agent's calls mostly ran, by output tokens in the last day, week or month of telemetry, when the provider lists it, and no model the calls ran less takes its place.
One substitution is made: Haiku on a provider that lists no Haiku becomes that provider's newest Sonnet, the model its gateway served Haiku requests on before, and the agent keeps a note of it until its owner saves a default.
Several fitting providers, a provider without that model, or nothing to go on saves the default as not set; a provider not listed yet is left for a later try.
The owner is told on [Home](home-feed.md#default-model-notices) about a default that is not set, one on a provider the agent no longer holds, and one the conversion changed.
The conversion runs after each `hello` while nothing is saved, and once per channel turn.
A schedule fire for an agent moved to a new image and still asleep wakes it first, so the fire is checked, converted and resolved against the new runtime rather than the one its last `hello` came from; when the new runtime does not say hello in time, the fire fails as still setting up instead of going out on the old view.
Run Now on such an agent refuses with "setting up" and starts that wake in the background.
**A turn with no model.** On a harness that reaches its models through the Model Router, the runtime refuses a turn whose session has no model, with the `no-model` reason, whether the turn starts a session, prompts one or resends an edited message; the router or the harness never picks a model in its place.
A harness on a native Connection, or an agent holding no provider whose API the harness speaks, is not refused, and before the pod's env arrives every routed harness needs a model.
The turns the platform starts on its own carry the agent's saved default: kit setup, and the result of a satellite Job or of a sub-agent when no waiting session takes it.
A session from before the Model Router carries no model, and it ran on the agent's one provider and its default model, so a channel turn or an api-server trigger that continues it pins the agent's saved default on it first, and a one-time task or a sub-agent result that continues it pins the model the event names.
A scheduled run with no model, such a task when it names none, an interrupted turn on such a session, or a chat prompt in it is refused until a model is picked.
A web terminal is the exception: the person sees its model in the harness's own screen and can switch it there, so a new terminal starts on the agent's default when the default is on its harness, and otherwise with no model, on the harness's own default.
Each binding says how the harness takes the value.
A session-scoped one (`mode`, `configOption`) is sent as ACP `session/set_mode` or `session/set_config_option` to that session only, never by recycling a harness other sessions share.
The runtime sends it again whenever the session is loaded or resumed into a harness process.
Settings are sent one at a time, in the order the runtime lists them, each after the harness answered the one before, because a harness reads a setting against the state an earlier one left: a mode is read against the model the session holds.
A prompt waits for all of them.
A setting always holds a value: the picker starts on the agent's configured value for the harness, or, for a mode the runtime derives, on the mode it derives, or else the manifest's `default` for the option, and offers no unset choice, so a change always names a value the harness applies.
A session that names no mode starts on the mode the agent's config file names, which the harness reads itself.
Where that file names none, the runtime derives one from the catalog — the option's `default`, and where the session's model cannot use it, the first choice the model's constraints allow — and only for a harness whose manifest opts in with `deriveStartMode`, one that starts on no mode of its own.
A harness that keeps its own sources of a start mode does not opt in: Pi's ACP mode is its thinking level, which it takes from the resumed session, then a per-model value, then the global default, and Bob's is the persona a Connection pins.
Claude Code opts in, and its catalog defaults to `auto`, so a chat session starts in auto as its terminal does, and a session on a model that cannot use auto, such as Haiku, starts asking instead.
The terminal launcher keeps its own fallback, which asks for no model, so a Haiku terminal session still passes `auto`.
A session that names no model runs on the model the file names, so that model's constraints are the ones applied.
The derived mode is the runtime's, not the session's: it never replaces a mode the owner or the session picked, and a change of the session's model derives it again, since the new model may allow another mode than the old one.
A mode the harness reports is the runtime's own doing while the runtime still owes the harness an answer that produced it: a derived mode in flight, or the model a mode is read against, whose answer carries the mode the harness reconciled.
Such a report is not saved as a mode the session picked.
What was chosen against what was worked out is the distinction: a mode someone chose — a client's own request, or the mode the owner saved, which the runtime sends for it — is the session's, and the harness's report of it confirms the choice.
Work still queued behind a running turn has not reached the harness and cannot have caused a report; but a mode someone chose and that has not been sent yet is newer than a report arriving now, so the report is not saved over it.
Two settings that name the same mode are not the same event: only the setting that reached the harness can have caused the report it answers.
Once the runtime owes nothing, a reported mode is the harness's own, as entering plan mode with a tool is, and is saved; a session the runtime derives a mode for then stops deriving, since the session holds a mode now, and a derived mode still queued behind the turn is dropped rather than undoing it.
A mode report that the runtime did not ask for and that arrives after its work settled is indistinguishable from a mode the harness changed on its own, and is saved as one.
A refused model is asked for again ahead of the settings that wait on it, and a client's own setting request keeps its place in that queue and is answered as usual.
A change made mid-turn waits for the turn to end, and the next prompt waits for the harness to answer the change.
A process-scoped one (`env`) is a value the harness reads only at start, such as Claude Code's prompt-cache TTL or Bob's approvals flag; it joins the Harness Lease key, so the session moves to a process started with it and the other sessions' process is left alone.
Such a move is refused while the session's turn runs.
Bob reads one settings file under its home and watches it, so each Bob lease points that file at a copy of its own through a preload.
Only Bob itself runs with the preload: its bootstrap reads the agent-wide choices from the shared file and writes the copy.
The task store, rules and MCP configuration under `~/.bob` stay shared.
A runtime without the `sessionSettings` capability keeps the Config panel's harness defaults instead.

The same record holds the session's **platform sub-agent settings** under `platformSubagent.<id>`: a harness, its model, its mode and its config options, which a runtime that reports `platformSubagentSettings` for the session's harness on hello accepts whatever the manifest binds, since they configure another agent ([invocations](invocations.md#spawning)); the Subagents section offers them only then.
They join no Harness Lease key and reach no harness; the api-server reads them when the session spawns, and the saved pair and schedules carry them with the rest.
A mode or config option is checked against the chosen harness's catalog when it is set; the model, and a harness the agent no longer carries, only at spawn, so a stale choice never blocks the session's other settings; a choice the catalog marks `needsApproval` (Claude Code's asking modes, Bob's approvals on ask) is refused, because nobody is there to approve.
The Subagents section shows them below the settings for the harness's own subagents: a harness, then its models and settings; picking another harness clears the rest.

An unreadable setting is unavailable, not an unset default.
Pi receives its selected provider and model as command-line options, because its extension loads after startup settings have been read; updating the saved defaults alone would leave the first turn on an earlier provider.
A runtime with a harness that has a harness config but no `sessionSettings` predates per-session routing: its harnesses ignore a lease's model, and Pi then falls back to its built-in Anthropic default.
For such an agent the chat shows an update notice instead of the picker, and new sessions, schedule fires and channel turns name no Session Pair, so they run on the agent's defaults.

The ETE LiteLLM proxy answers Claude Code's auto-mode permission check on the model call itself, through the beta header the proxy accepts.

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
A kept list can offer a model the provider has since retired.
A turn on a model the provider no longer serves reports the provider's refusal.
An existing session's label marks a model its provider no longer lists, so a turn that runs on another model than the pick never does so unseen.
Which choices a harness offers is its catalog's to say: Codex's offers no mode, because its image runs it never asking for approval, so there is no permission mode to pick and nothing for a [channel turn](channel-turns.md) to refuse.

## The model catalog

agent-runtime keeps one **Model Catalog** per pod: every granted provider Connection's models, listed from that Connection's env layer (the api-server tags each provider layer with its Connection and template), under the **qualified name** `<alias>/<upstream id>`, the alias fixed per preset ([connections](connections.md)).
Each preset lists the way its key allows: `/v1/models` for the LiteLLM proxies (IBM's virtual keys get 403 on every model-info route), Anthropic's and OpenAI's model lists, Bob's gateway model-info.
The platform provider's self-hosted vLLM is listed from `/v1/models` on its root with the Connection's placeholder, so the gateway adds the operator's key, and the maximum model length each entry reports is its context window.
Metadata is layered per model, first answer wins: the listing itself (Bob's model-info carries limits and prices, vLLM's list the context window, and the platform provider's models cost nothing), then the vendored LiteLLM price table (`model_prices_and_context_window.json`, re-vendored by `//packages/agent-runtime:update:model-prices`), then the preset's per-endpoint constants in the layer (`OPENAI_PROXY_CONTEXT_WINDOW` and kin); each value records its layer, and cache marks and the thinking format are family rules by id.
An Anthropic subscription (OAuth token) Connection is listed from Anthropic's model list like the key Connection and offered to Claude Code alone, since Anthropic accepts the token only from Claude Code; the router refuses it to any other harness by name.
Bedrock is the one **native Connection**: its SigV4 signing is no header swap, so the router never lists or routes it, and every harness but Claude Code sees it as unsupported.
Claude Code's view lists it under its alias with Claude Code's own tier names (`bedrock/sonnet`); a session on one runs in a Claude Code process of its own, started with the Connection's env instead of the router's, and switching between it and a routed model moves the session between processes once the running turn ends.
Beside a routed provider, a turn with no model is refused (see **A turn with no model**), and a web terminal with none starts through the router on the harness's own default; Bedrock's env reaches a process only when no routed provider serves the harness.
One process reaches either the router or Bedrock, so a session's subagent model is offered from, and must come from, the same side as its model.
No model counts as the router side, since a session without a Bedrock model reaches the router.
A schedule's pair is checked at save against the model its fire resolves to (the schedule's own, else the saved default; with no default model the check passes and the fire reports the missing default), and each harness reports the templates it runs natively in its runtime capabilities.

Each harness's manifest declares in its `modelRouter` section the dialects it speaks (Claude Code: Messages; Codex: Responses; Bob and Copilot: chat; Pi: all three) and its name spelling (Claude Code's gateway discovery keeps only ids containing `claude`, lowercased, so it sees `claude/<alias>/<id>`); a harness's view of the catalog is the entries whose provider serves one of its dialects.
The catalog is built when the env rail materialises, rebuilt on every env change and on a timer; a failed listing keeps that Connection's last good list, marked unavailable, and never empties another's.
A failed listing is retried after two seconds, then twice as long each time up to five minutes, and an env change starts that ladder over: a grant also restarts the agent's egress gateway, so the listings that follow it fail until the gateway is back.
A Connection granted but not yet listed is in the view at once, unavailable and never listed, and every change to the catalog sends the harness-config watch notice.
A routed harness answers its model list from the catalog; `harnessConfig.catalog` on the runtime's tRPC returns the same view grouped by provider with the metadata.

## The Model Router

agent-runtime runs one **Model Router** per pod, a loopback HTTP listener (`127.0.0.1:24180`, `PLATFORM_MODEL_ROUTER_PORT`) every harness process points its one base URL at, with `X-Platform-Harness` naming the caller.
It passes through and never translates: the path classifies the dialect (`/v1/messages` and `count_tokens`: Messages; `/v1/chat/completions`: chat; `/v1/responses`: Responses; doubled slashes, pi-ai's `/v1/v1/` and Bob's `/inference` prefix folded first), the `model` resolves to a catalog entry, and the call leaves for that entry's Connection only when it serves the dialect, else it is refused with the reason.
A qualified name resolves outright, case-insensitively on the upstream id; a bare name is looked for on the session's provider, then the harness's default provider, then the single provider listing it, and refused naming the candidates when several do.
A bare name no provider lists, in either case, falls back to the entry whose upstream id's last `/`-separated segment is that name, compared without case, so a provider fronting a cloud account answers for the exact model it serves under its deployment prefix (`aws/claude-sonnet-5`), and one that does list the bare name keeps it.
Two ids of one provider that match that way, like two of its deployments, are refused naming both.
The session is read from what each harness stamps: Bob's `X-Task-Id` (the root task id is the ACP session id; `X-Parent-Task-Id` marks a subagent's calls), Codex's `session-id` header (its thread id, the ACP session id; a subagent's own `thread-id` beside it), Claude Code's request metadata `user_id` ending in `_session_<uuid>`, and Pi's `x-platform-session`, which its extension sets to the platform's session id.
In a terminal, Codex and Bob run under their own id, which the router maps back to the platform's session id through the pins that their session-start hooks write (`terminalSessionPins`); Claude Code's terminal runs under the platform's id, and Pi's extension sends it.
A Codex terminal also sends the platform's id in `x-platform-session` (`env_http_headers`), which names the session of a thread that has no pin, such as the TUI's title thread.
Copilot stamps nothing on its calls, so a call from its chat process is routed by its qualified name alone, and its manifest's `sessionFromRunningTurn` books it to the one Copilot session running a turn; while several run at once, the call names no session.
A Copilot terminal runs under the platform's id (`--session-id`) and sends it in `x-platform-session` through `COPILOT_PROVIDER_HEADERS`.
The router stamps each forwarded call with `x-platform-session` (when it found a session) and `x-platform-harness`, and it never passes the stamp that a harness sent; the gateway's [meter](spend-limits.md#meter) records the stamp and removes it before the provider.

The router **owns upstream auth**: the client's credential headers are dropped and the target Connection's placeholder is set in the header it claims at the [credential gateway](credential-gateway.md) (`Authorization: Bearer` for the LiteLLM proxies, the platform provider, OpenAI and the Anthropic subscription, `x-api-key` for the Anthropic key, `Authorization: Apikey` for Bob's gateway); the router never holds a secret.
It adds Anthropic's OAuth beta flag to a call bound for the subscription Connection, removes it from every other call, and passes the other `anthropic-beta` flags as sent, so one Claude Code process mixes the subscription with any routed provider.
The body goes out with `model` rewritten to the upstream id; the response comes back with only its model field rewritten to the name the harness asked for, so transcripts record the provider.
No retries: a second model call is a second bill.
An upstream error keeps its status and headers, and its message gets a lead sentence that names the provider, the model, the API and the harness, so the harness shows where the call failed; a [spend refusal](spend-limits.md#refusal) passes unchanged.
Each call is reported once on the telemetry rail with its tokens, Connection, upstream model, dialect, harness and session, and no cost: every spend figure reads the gateway's [meter](spend-limits.md#ledger).

**Replay rules** apply by target, since the router cannot know which model wrote a history: for a Claude model, every assistant message but the last has its thinking blocks turned into `<thinking>…</thinking>` text; for a Responses target other than OpenAI, reasoning items and `client_metadata` are dropped and a tool-less request's tool items become text; for OpenAI only reasoning items with a non-empty `content` array are dropped; chat completions replay unchanged.
The router also fits the output budget to the catalog's limit, drops a reasoning effort sent to a model that does not reason, and adds `include_usage` to a streamed chat completion so its final chunk carries the usage.
The effort level Claude Code persists, sent as `output_config.effort`, is rewritten to the nearest level a DeepSeek target's chat template knows, since that template refuses the whole call on a level it does not: Claude Code's `medium` default becomes `high`.

Beyond the model routes the router serves each harness's **catalog endpoint** from its view: `/v1/models` in the OpenAI list shape (`display_name` and `description` for Claude Code's picker, a `metadata` extension Pi registers its provider from), `/codex/models` in Codex's `ModelInfo` shape (a missing field makes Codex drop the catalog silently), `/inference/v1/model/info` in LiteLLM's shape for Bob, `HEAD /api/hello` for Claude Code's probe; Bob's `/admin/v1/*` calls get a JSON 404.
A catalog request waits up to ten seconds for the pod's first listing and answers 503 while a provider has not listed, which a harness retries rather than caches.
A harness whose manifest says `modelFromSession` (Bob, one settings-file model per process) gets the session's model on every call; a tier alias its subagents ask for (`premium-ide`, `explorer`), and on Codex (`bareNamesFromSession`) any bare name, is mapped the same way.
A session's **subagent model** is one setting delivered three ways: Claude Code reads `CLAUDE_CODE_SUBAGENT_MODEL` at process start, forced (`CLAUDE_CODE_SUBAGENT_MODEL_FORCE`) over the Agent tool's model argument and an agent definition's model, so the session runs in a process of its own; Bob's and Codex's subagent calls carry a parent marker (`X-Parent-Task-Id`, a child `thread-id`) and the router sends them to the session's choice, nothing written to the harness (manifest binding `router: true`).
A session's **subagent effort** (Claude Code, Codex) is a `router: true` setting too: the router writes it over the effort a call marked as a subagent's carries (`output_config.effort`, `reasoning.effort`, `reasoning_effort`), and leaves a call that carries none alone, since the harness sends none to a model that takes none.
Its catalog option says `subagents: true`, so its model constraints come from the subagent model, not the session's.
A session on a native Connection (Bedrock) sends no call through the router, so its subagent effort has no effect.
Both settings reach only the harness's own subagents; a platform sub-agent follows the session's platform sub-agent settings ([session settings](#session-settings)).
Pi's image has no subagents, so Pi has neither setting.

## Model discovery and the agent's default model

A harness without a `modelRouter` section (a custom template's own harness) lists its models from the `modelDiscovery` source its manifest declares: the first source whose variable is set answers, through the OpenAI model list, LiteLLM's model info or Bedrock's inference-profile listing, under the manifest's prefix and case.
Routed harnesses answer from the [model catalog](#the-model-catalog) instead.
Nothing is seeded into a harness's config file; a run with no choice gets the agent's default ([session settings](#session-settings)).
A routed harness that refuses to start without a model names a variable in its manifest's `defaultModelEnv` (Copilot's `COPILOT_MODEL`), and the runtime sets it to the first model of the default provider that serves the harness; the session's own model then reaches it over ACP.
A model the provider does not list fails the turn with the router's reason rather than being replaced.

Bedrock stays native: Claude Code runs on it outside the router, and a routed Pi does not reach it.
The [AWS Bedrock](connections.md#app-preset-aws-bedrock) Connection names the region's control-plane endpoint, and Pi's manifest declares it as a source ahead of its OpenAI one, speaking Bedrock's inference-profile listing — the profiles that can be invoked from that region, each carrying a region prefix a bare model ID lacks, which is why a typed ID is the wrong unit to offer.
Models Bedrock also serves on demand under their bare ID are not in that listing, so they are not offered either; the Anthropic models a coding harness runs on are reachable only through a profile.
What no listing can say is whether the account has been granted a model: that is learned at the first call, as an error the turn reports.
Claude Code's catalog is model tiers, which Claude Code itself resolves to the region's Bedrock profiles ([connections](connections.md#app-preset-aws-bedrock)); on the router the runtime fills each tier slot with the agent's default provider's newest model of that tier.

The runtime also reports the harness's **default**, what a session runs on when the config file names no model: a manifest-declared value that selects the harness's built-in default for one session.
Only a harness that can switch a session's model reports one.

## Snapshots

Because the live read needs a running pod, the platform also keeps a **snapshot** of these values, so the Config panel renders the last known configuration while the agent is stopped.
An apply records what it *declared*; a snapshot is display state and is never re-asserted onto the harness, so the harness's own file stays authoritative and the live read wins whenever the agent is up.
A snapshot always carries the moment it was captured, and whether a pod has confirmed it or it is merely what an apply asserted — the distinction matters precisely because the event never re-asserts, so a hand-edit can move the file out from under a declared value.
Snapshots are kept per harness, and the pod reports each carried harness's values at two points, and the split is forced: on `hello` it reports the files' values alone, since a clean boot with nothing pending never applies and a hand-edit would otherwise go unseen for that whole run; the apply reply reports those plus the discovered model list, which can only be resolved once the env driver has materialized the provider's base URL.
A report omits the model list when it could not be resolved, so a failed read never erases one an earlier read established; a harness with no discovery source, or no provider for one, records that fact instead.
