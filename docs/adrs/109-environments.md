---
id: 109
title: Environments are vm sandboxes an agent owns, reached by the owner's chosen people at an origin per endpoint
status: accepted
subsystem: environments
tags: [environments, vm, preview]
summary: An owning vm Agent creates Environments — Agent records naming it, with no harness and no connections, on its owner's VM runner — and people and agents its owner chose open each endpoint at an address of its own behind an api-server gate.
---

# ADR-109: Environments are vm sandboxes an agent owns, reached by the owner's chosen people at an origin per endpoint

**Date:** 2026-10-19 **Status:** Accepted **Owner:** @jezekra1

## Context

An agent that builds a pull request can run it in its own sandbox, but nobody else can open it: the sandbox holds the agent's session, memory and credentials, so it cannot be shared, and one sandbox runs one build at a time.
Reviewers read diffs without trying the change, and a QA agent rebuilds what the developer agent already built.

## Decision

An **Environment** is a sandbox an Agent creates and controls to run software for others to open.

- **An Agent record underneath.** It names its owning Agent in an immutable field, runs on the vm backend on its owner's VM runner, boots the platform's image with no harness, and holds no connections, no default model provider and no egress preset. Users see it as its own kind of thing under its agent, never as an agent.
- **Owned by one vm Agent.** Only a vm Agent owns Environments; deleting it deletes them. A cap per agent and an expiry bound the install's load, and the platform deletes an Environment once its expiry passes.
- **Its app starts at every boot** as a Startup Item; it sleeps like any vm sandbox.
- **The owning Agent reaches it directly**, over a one-way link the VM runner brokers between the two machines. Everyone else goes through the platform.
- **One origin per endpoint**, `<endpoint>-<environment>.<environments domain>`, behind one wildcard Ingress and one wildcard certificate, so Environments cannot read each other's storage. Not paths on a shared host, not a streamed browser.
- **The owner chooses who.** The owner keeps a list of emails per agent; the agent can narrow it per Environment, never widen it. People sign in through a dedicated identity provider client; other agents enter as their owner, proven by their own gateway.
- **Network** follows the owning Agent's egress rules; only the owner grants an Environment a connection.

## Alternatives Considered

- **Paths on the artifact content host** — one origin for every Environment and artifact lets each read the others' storage and cookies, and most apps cannot run under a path prefix.
- **Streaming the browser panel to more viewers** — every viewer shares the agent's one browser or costs a browser in its sandbox, and a QA agent cannot point its own test suite at it.
- **A tunnel to localhost for each viewer** — needs the CLI and a sign-in on each machine, and gives no link to click; kept as a later addition.
- **Any image as the Environment** — needs build-time injection of a platform daemon; the platform's image with Docker and k3s inside covers the same apps.
- **A container-backend owner** — a pod has no runner to broker the direct link, and container agents are being retired.

## Consequences

- **Easier:** a reviewer opens a running pull request from a link; a QA agent tests the same build; several pull requests run side by side, each in its own machine.
- **Harder:** an install that wants Environment addresses needs a wildcard DNS name and certificate; untrusted pull-request code runs on the same VM runner as its owner's agents, so a guest escape reaches them; addresses under a shared corporate domain are the same site as the platform, which the gate's cookie handling has to account for.
- **Committed-to:** the immutable owning-Agent field on the Agent record, one origin per endpoint, and the owner's list as the ceiling of who may open an Environment.
