---
name: qi-profile-dam
description: >-
  Product profile for testing DAM — the agent platform — with the quality-inspector agent (helm-k3s engine) — and what a tester should know about DAM from a user's point of view.
  Load when quality-inspector freezes acceptance criteria or writes tests for DAM.
---

# DAM — what a tester needs to know

DAM runs AI coding agents (Claude Code, Codex, Pi, Bob) in isolated environments.
The nested install is a fresh, single-user platform at `http://localhost:4444`, signed in as the test owner from `credentials.env` (a local account of the bundled sign-in service).

## Vocabulary a user sees

- **Agent** — a running harness with its own workspace; created from a template or a starter kit, opened in a chat view, can hibernate and wake.
- **Starter kit** — a ready setup an agent is created from (connections, schedules, size).
- **Connection** — a stored credential (model provider, GitHub, Slack…) granted to agents.
- **Schedule** — a recurring task on an agent.
- **Artifact** — a work product an agent or user publishes, shareable by link.
- **Settings** — API keys, providers, connections, appearance, usage, schedules, about.
- **Home** — what changed since the user last looked; agents, usage, spend.

## What the nested install cannot do

- No outbound network from inside the nested cluster: real model providers, GitHub, Slack and Telegram do not work.
  An AC that needs any of them is `testable: no — external dependency`, unless it only checks that the UI offers or records something.
- Agents only answer when the profile's `mock_image` is set (a scripted mock harness).
  Without it, an AC that needs an agent to reply or run is `blocked`, not failed.
- One user.
  ACs about sharing, other users' access or approvals between people need a second account — `testable: no — single user` until the profile adds one.
- No email, no SSO federation, no real billing.

## Versions

Builds are chart versions: `0.0.0-main.<n>` after every merge to main, `X.Y.Z` releases.
Candidate `main` = the newest dev chart; baseline `release` = the newest release.

## CLI and API

The published CLI is the npm package `@dam-agents/cli` (`dam`).
In a test: install it into `work/suite`, set `DAM_SERVER` to the app URL and `DAM_TOKEN` to an API key the test's setup creates under Settings → API keys; `--json` on every read verb.
The HTTP API takes the same key as a bearer token.

## Channels

`candidate_channel`: `main` (default) \| `release`.
`baseline_channel`: `release` (default) \| `none`.
