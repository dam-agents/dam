# 03 — Pi's output limit on LiteLLM

**Depends on:** 01-pi-keeps-cut-reply
**Part of:** Pi agents keep a reply that hits the output limit — see [README](./README.md)

## Context

The 8192-token cut comes from our own setting: the IBM LiteLLM connection sets
`OPENAI_PROXY_MAX_TOKENS=8192`, and only Pi reads it. Every working chat model on the proxy
accepts 64000 (see the README's evidence table), so this slice raises the value to 32768, the
value the Curve Bender connection already uses. A connection stores its contributions when it is
created, so existing IBM LiteLLM connections need a data migration. The same slice switches the
`openai-proxy` provider to `max_completion_tokens`: `azure/gpt-6-astra` rejects `max_tokens` at
any value, and every model on the proxy accepts and honors `max_completion_tokens`. (Found during
implementation: `gpt-6-astra` still fails in Pi after this, because it also refuses function
tools on chat completions. A follow-up; the field stays.)

## Implementation plan

Apply `/typescript-engineering`.

1. **Template value**,
   [`packages/api-server-api/src/modules/connections/providers.ts`](../../../packages/api-server-api/src/modules/connections/providers.ts):
   in `ibmLitellmEnvMappings`, `MAX_TOKENS: "8192"` becomes `"32768"`. New connections get it.

2. **Data migration for existing connections.** Scaffold it with
   `mise run //packages/db:new -- raise_ibm_litellm_output_limit` (hand-written SQL plus journal
   entry and snapshot; never hand-edit the journal). The migration does two things in one
   statement, following
   [`0054_bump_agents_holding_reserved_mcp_entries.sql`](../../../packages/db/drizzle/0054_bump_agents_holding_reserved_mcp_entries.sql):
   - In `connections` rows with `template_id = 'ibm-litellm'`, rewrite the `env` contribution
     named `OPENAI_PROXY_MAX_TOKENS` from placeholder `"8192"` to `"32768"`. Keep the array order
     (`jsonb_array_elements … WITH ORDINALITY`, `jsonb_agg … ORDER BY`). Touch only rows that
     still hold `"8192"`, and set `updated_at`.
   - Bump `runtime_state_outbox.version` (and `last_enqueued_at`) for every agent with a
     `connection_grants` row on a changed connection. An `env` contribution travels on the runtime
     channel rail, and delivery runs only when the desired version moves. Without the bump,
     running agents keep 8192. Use a data-modifying CTE (`WITH raised AS (UPDATE … RETURNING id)`)
     so the bump sees exactly the changed rows.
   - Start the file with a short comment that says why (the `packages/db` rule), like 0054.
   - The runtime applies a changed `env` at the next harness spawn and recycles the harness at an
     idle turn boundary ([connections](../../architecture/connections.md), the `env` row of the
     rail table), so a running turn is not cut.
   - If main adds a migration before this lands, scaffold the file again with `db:new` instead of
     renaming it: drizzle skips a migration whose `when` is older than the newest applied one.

3. **`max_completion_tokens` on `openai-proxy`**,
   [`pi-dynamic-providers/index.ts`](../../../packages/agents/pi-agent/rootfs/usr/local/share/pi-platform/extensions/pi-dynamic-providers/index.ts):
   add `maxTokensField: "max_completion_tokens"` to the `openai-proxy` compat override from 01.
   `rits` keeps `max_tokens`. pi-ai's `openai-completions` then sends
   `params.max_completion_tokens`, and LiteLLM translates it for each backend. Curve Bender uses
   the same provider. It was not reachable for a probe; the IBM proxy's `rits/*` models (the same
   RITS backend) accept the field. Probe Curve Bender in the smoke test if it is reachable,
   otherwise say so in the PR.

4. **Pi agent README**,
   [`packages/agents/pi-agent/README.md`](../../../packages/agents/pi-agent/README.md): next to
   01's note on streamed usage, say that `openai-proxy` sends `max_completion_tokens`. No
   architecture page names the limit; leave them alone.

## Acceptance criteria

- [ ] A new IBM LiteLLM connection's stored contributions hold `OPENAI_PROXY_MAX_TOKENS` =
      `"32768"`.
- [ ] After the api-server starts on the branch, a connection created before it holds `"32768"`
      too, and its agents' outbox versions moved by one.
- [ ] In a Pi agent on such a connection, `~/.pi/agent/models.json` shows `maxTokens: 32768` and
      `compat.maxTokensField: "max_completion_tokens"` for the `openai-proxy` models, and
      `max_tokens` for `rits` if present.
- [ ] A 7000-word document request completes with `usage.output` above 8192, a normal stop, and no
      output-limit line.
- [ ] ~~`azure/gpt-6-astra` answers a prompt in a Pi agent.~~ Dropped: it refuses function tools
      on chat completions (a follow-up).
- [ ] `mise run //packages/db:check`, `mise run //packages/agents:check` and `mise run check`
      pass.

## Smoke test

1. Before rebuilding, make sure the dev cluster has a Pi agent on an IBM LiteLLM connection
   created with the old template, so the migration has a row to change.
2. Rebuild and load: `mise run cluster:build -- api-server agents`. The api-server applies the
   migration on start; its log shows no migration error.
3. Without printing env, read Pi's model config in that agent's pod once the harness has
   recycled (send a prompt first):
   `mise run cluster:kubectl -- exec -n platform-agents <agent-pod> -c agent -- sh -c 'grep -o "\"maxTokens\": [0-9]*\|\"maxTokensField\": \"[a-z_]*\"" ~/.pi/agent/models.json | sort | uniq -c'`
   shows `32768` and `max_completion_tokens`.
4. Ask: "Without tools, write a detailed 7000-word design document for a URL shortener, in this
   one reply." It completes without the output-limit line. The session file shows `usage.output`
   above 8192.
5. (Dropped: `azure/gpt-6-astra` cannot answer in Pi; see the context.)
6. If a Curve Bender connection is reachable, repeat step 4 with one of its models. (It was not
   reachable from the dev cluster.)

Print a short version of these steps for the user so they can confirm by hand.
