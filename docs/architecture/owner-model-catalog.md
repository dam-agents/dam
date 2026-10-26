# Owner model catalog

Last verified: 2026-10-26

## Overview

The api-server keeps an **owner catalog** beside each agent's catalog: every model provider Connection the owner holds, listed from that Connection's env pins and its stored credential, with no agent involved.
It is the read behind a picker that has no agent to ask, such as Settings › Profiles, and behind showing models from providers an agent does not have attached.

## Listing without an agent

A provider Connection's env pins are plain URLs in its Contributions, and its credential is in the secret store.
The api-server already calls provider endpoints with that credential for the key check and the balance lookup; credential injection through the egress gateway is only how a sandbox's traffic gets the key.
The catalog uses the same listing specs, discovery parser and metadata layers as the [per-agent model catalog](harness-config.md#the-model-catalog), and sends each credential the way its provider expects, Bob's `Apikey` scheme included.
Harness fit comes from the shipped harness catalog, and a model known to hold under 32k is left out of the harnesses it would otherwise fit.
A Bedrock Connection lists the native tier models its harness runs instead of a provider listing.
A model is named the plain `<alias>/<id>` a session stores; the runtime renders a harness's own spelling when it starts.

## Shipped harness capabilities

The response also carries the harness capabilities the runtime advertises on `hello`: the `harness-config` settings catalog, its session-setting ids and its derived start modes, plus the templates each harness runs natively and their tier names.
The source stays the agent runtime manifests.
The api-server image build copies each one under its harness name, and the api-server parses only the `modelRouter` and `harness-config` facts it needs ([runtime delivery](runtime-delivery.md#the-manifest)).
A manifest the image lacks leaves that harness without capabilities rather than failing the catalog.
This is what lets Settings › Profiles offer effort, mode and Bedrock tiers with no agent.

## Cost and freshness

A good listing is kept in memory for thirty minutes; a failed one keeps the Connection's last good list, marked unavailable, and is retried after ten seconds.
The first read of a Connection waits for its listing; later stale reads return what is kept and refresh behind the answer.
Nothing polls: the api-server lists only what a request asks for, and drops the entries of Connections the owner no longer holds.

## Auth

Only a principal unrestricted across the owner's agents reads the catalog; an agent-bound API key is refused, since the catalog spans every Connection the owner holds.
The credential stays in the api-server for the length of the listing and is never returned.
