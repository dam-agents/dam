---
title: "feat: ChatGPT subscriptions for Codex sessions"
type: plan
date: 2026-11-04
status: complete
confidence: medium
---

# ChatGPT subscriptions for Codex sessions

An owner can select a ChatGPT subscription for Codex and use the agent's native login in terminals, web chat and Slack.

## Problem and target

The OpenAI provider accepts only an API key, and Codex's launch configuration forces API authentication.
A device login does not change where managed sessions send inference.
The target is an explicit subscription provider mode that runs Codex natively, while other provider sessions continue through the Model Router.

## Scope

Add an OpenAI subscription mode, a native Connection template, named native models, consistent launch configuration and device-login instructions.
Authorization happens once per agent, in its web terminal or over SSH; subsequent web chat and channel turns reuse that login.
Codex owns token acquisition, storage, refresh and logout in its persistent home.
Do not turn a Codex token into an API key or implement an independent OpenAI OAuth client.
Do not change other harnesses or make subscription credentials reusable across agents.
Deployment and a real subscription inference turn require a separate live validation after local checks.

## Structural preview

Settings → OpenAI → ChatGPT subscription → enable provider → attach to agent → authorize in agent terminal → select a native Codex model → save the agent/channel default → send a web or Slack turn.
Expired or missing login fails visibly; the owner signs in again on the same agent.
There is no fallback to a paid API credential.

## Approach and rationale

Reuse the native-provider path already used by Bedrock: a provider Connection, a native model list in the harness manifest, and a separate native Harness Lease selected by the session's qualified model.
Keep the OpenAI alias, so an agent chooses one OpenAI credential mode at a time, under the existing provider-alias rule.
The subscription Connection carries a mode marker and network permissions, not a pasted token.
Codex's native login remains in its existing home so MCP configuration, instructions, history and terminal resume continue working.
Remove the global API-only login restriction; the router provider explicitly uses its environment credential and never requires a native OpenAI login.
Native launchers override the provider and authentication method, discard inherited API credential and endpoint variables, and disable the router's API model discovery.

## Constraints and risks

Native login is an explicit exception to the gateway-only upstream credential rule, recorded in a proposed decision before implementation.
The agent can read its subscription credential, and anyone able to run work on that agent uses that account's subscription.
Network traffic still exits through the gateway and remains subject to its rules.
Native calls bypass router-based provider metering and spend limits; the feature must not claim those controls apply.
The native model list is a list of supported choices, not proof of account entitlement.
Models follow current official OpenAI guidance; access is proven only by an inference turn.
Existing API sessions must neither use nor clear the subscription login.
Detaching the Connection stops managed native selection; revoking the native account session is a separate logout operation.

## References and assumptions

Positive references: Bedrock native model selection, Anthropic credential-mode tabs, Codex's current launchers and telemetry tests.
Avoid copying a subscription token into an API-key field, overriding every Codex process globally, or silently changing an agent's default provider.
Official references: [headless authentication](https://learn.chatgpt.com/docs/auth#login-on-headless-devices), [supported models](https://learn.chatgpt.com/docs/models).
Verified: Connection templates support no platform-held credential; owner and runtime catalogs already list native manifest models; native leases strip provider qualification before setting a model.
Local checks verified native cache preservation, the ACP launch configuration and channel/default validation.
Real account authorization and completed web/Slack inference remain live rollout checks.

## Tasks

- [x] Inspect the existing provider, native lease and authentication flows; prepare the structural preview and decision draft.
- [x] Add the subscription template, provider mode and Codex-only compatibility, with focused Connection tests.
- [x] Add the native Codex launch path and device-login command, with behavioral shell tests that retain API behavior and protect the native cache.
- [x] Add native model choices and verify owner/runtime catalogs, session settings and default selection.
- [x] Add provider selection and per-agent login instructions to the UI; update the Quality Inspector profile and focused UI tests.
- [x] Update subsystem documentation, run the relevant checks, inspect the final diff and record local/live validation limits.

## Local validation and live handoff

The UI suite passed 1,587 tests, the API suite 3,581 and the runtime suite 917.
The runtime suite needs the host's EDITOR unset for its environment-precedence fixture; its watcher test passed when rerun without the parallel suite load.
Type checks and lint passed for the changed packages.
Behavioral launcher tests and the existing telemetry regression passed.
An offline test against the exact pinned Codex 0.159.3 verified cache preservation across API and native app-server starts and checked the native model list.
That client lists Sol, Astra and Luna; Terra was removed after the real-client check rejected it.
The client caches a missing account, so native chat now checks login before starting ACP and gives an actionable error instead of retaining an unauthenticated process.
After reauthorizing an expired login, logout or an account change, the owner restarts the agent to replace existing cached account state.
No real account or inference request was used in these checks.
AWS deployment, agent image upgrade, browser device authorization and a real web/Slack inference proof remain live rollout steps.

## Acceptance and rollout

Enabling subscription mode asks for no API key and offers Codex alone.
A granted subscription offers native named models in web, terminal and channel/default selection.
Native launches use ChatGPT authentication and never the router placeholder or an API endpoint override.
API launches keep using the router without clearing a cached native login.
Native device login, normal launches and resume retain instructions, MCP configuration and telemetry switches.
No access token, refresh token or authentication cache enters logs, test output or this repository.
Do not deploy until focused tests and checks pass; do not report live subscription support verified until a human completes device authorization and an inference turn succeeds.
The proof slice is one subscription Connection and one private agent; rejected authorization, missing credentials, unsupported harnesses and switching back to API mode must fail or behave explicitly.
No visual redesign is required; the existing provider form is the UI reference, with local rendering evidence when the app can run.
