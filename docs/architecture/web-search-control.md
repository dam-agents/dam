# Web search control

Last verified: 2026-11-10

## Overview

A model provider can run a web search for the model inside a model call: the IBM LiteLLM proxy runs it through its own search provider, and Anthropic runs it at Anthropic.
Such a search leaves from the provider's network, not the agent's gateway, so egress rules never see it, and the query the model writes leaves with it.
Web search control puts each such search under the owner's approval.
It is an Agent setting, off by default; an owner turns it on for an agent with a sensitive workload.
With it off, nothing changes: the gateway reads no body and search works as the provider runs it.

The control sits in the agent's gateway and the ext_authz gate ([security-and-credentials](security-and-credentials.md#hitl-ext_authz)), which the agent cannot change.
It covers a Messages API call that declares a native web search tool, on every provider that serves the Messages API (IBM LiteLLM, an Anthropic key, the Claude subscription), from any harness.
It does not cover Codex's hosted search or search through Chat Completions: there the provider decides to search inside its reply and runs it at once, so no request reaches the gateway before the search runs.
The setting's text says which harnesses it covers.

## The gateway

With the setting on, every model-provider chain of the agent's gateway ([credential-gateway](credential-gateway.md#envoy-credential-injection)) sends each request's whole body with its ext_authz check, up to 32 MiB, the Messages API's own request limit.
The gateway refuses a longer body with a 413 instead of sending part of it: a check that read part of a body could be padded past, with the search tool after the part it read.
Other chains read no body.
The gate reads every request such a chain sends, also one whose path the spend meter does not count, since the meter's mark of the chain, not of the path, says it is a model call.

The setting is part of the gateway's revision, so turning it on or off restarts that agent's gateway, a few seconds without egress, and the UI warns first, as it does for a rule that changes what the gateway inspects.
On an owner gateway, only that agent's listener changes.
A model call that has a body but reaches the gate without it comes from a gateway still restarting onto the setting, and is refused with a retryable answer rather than passed.
A sub-agent or an Environment that an agent with the setting creates has a gateway of its own, so it is created with the setting on.

## Reading a model call

The gate reads the body as one strict JSON document in UTF-8: a body that is not one, that repeats a key in any object, or that a lenient parser would read and a strict one would not, is unreadable, since a provider might read in it a tool the gate did not.
An unreadable body on a Messages endpoint is refused; on another endpoint, such as a file upload, it passes.
A call is a search when any tools list in it, at any depth, holds a native web search tool, the server tool whose type is web search and a date; a message batch therefore counts, and token counting, which runs no tool, does not.
The gate reads the path as a provider routes it, decoded and folded, so a path spelled differently still names the Messages endpoint.

The approval shows the query when the call has Claude Code's shape: Claude Code runs each search as a separate request that declares only the search tool and names the query in its one prompt.
Any other search leaves the query to the model, and the approval says so.

## The hold

For a search, the gate reads the agent's **web search rule** first: one per agent, allow or deny, never keyed on a query, because the agent writes the query.
It is stored apart from the agent's egress rules, and neither an egress rule that allows every host nor the allowance of a provider's own hosts lets a search through.
Rules and approvals belong to the agent whose rules decide its requests, so a sub-agent's search asks its driver, as its network requests do.
An open child, whose network allows only what is listed for it, has its search refused when no rule allows it.

With no rule, a search in a run nobody attends is refused at once: a channel turn with no interactive session attached, as for network requests, or a call whose Session a schedule started.
The Session comes from the Model Router's stamp, written in the machine, so it can only turn a hold into a refusal.
The refusal leaves its approval for the owner, and its text says how to add the rule that lets such runs search.

Otherwise the search waits as a **web search approval**, where network approvals show: in every open conversation of the agent, on Home and behind the approvals bell, and as an in-session prompt to attached clients such as the CLI.
A retry of the same search joins the waiting approval: the same query, or the same body when the model chooses the query; a different search files its own.
Allow once sends the call on to the gate's other checks, and deny refuses it.
Always allow and always deny write the agent's web search rule, also on an approval whose hold already ended; the owner changes or clears the rule under Web search in the agent's Network settings.

An allowed search still runs at the provider: the platform approves it but does not run it.
The IBM LiteLLM proxy lets the model search again with queries it writes after reading the first results, up to two more by its default, and reports only the first, so the approval says that an allowed search may run up to two more queries.

## The refusal

A refused search is answered as a successful Messages reply whose search failed as unavailable, streamed when the call streams, with a text that says the platform refused it, why, and how the owner changes it.
The agent reads a failed search and keeps working; a refused model call would end its session.
Claude Code then falls back to fetching pages, which run from the machine under the agent's egress rules.
An endpoint that creates no message, such as a batch, gets a plain 403 instead.
Every refusal carries the platform's refusal header, and the spend ledger drops the refused call as it drops every call the gate refuses ([spend-limits](spend-limits.md#ledger)).

## Limits

- Claude Code asks for its own permission to use its search tool before it sends the search request, so in its asking modes the owner can be asked twice.
- The IBM LiteLLM proxy ignores the domains a search asks to be limited to, and reports no searches in its usage, so the spend meter counts none.
- It covers the model calls of the agent's model-provider Connections; a model API the agent reaches with a key of its own, through an egress rule, is governed by that rule alone.
- Reading every body costs the agent's model calls a buffer and a parse in the api-server, which is why the setting is off by default.
