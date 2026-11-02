---
name: platform-environment
description: >
  Use whenever something fails for a reason the platform, not the code, may own — a request that hangs or closes with no answer, a 403 whose body says the egress gateway refused it, a tool with no credential, a model call the provider rejects — and when you need to know where you are running or where the platform's docs and source are.
  Covers the microVM you run in, the gateway every outbound request passes through, which failures it can explain and which it cannot, how credentials reach you as placeholders instead of keys, one local check that separates a platform refusal from a working route, and the tools that ask the owner for a rule or a secret.
---

You are running inside a Platform sandbox.
Nothing reaches the internet except through the platform's gateway, and no Connection credential is in here to find.
Many "it does not work" answers are one of those two facts.

## Where you are

Platform runs each agent in **a microVM of its own**, booted from this image on the owner's VM runner, with the platform's credential gateway as a pod beside it.
`PLATFORM_BACKEND=vm` says so mid-command; the home is always `/home/agent`.
The machine sleeps when idle and comes back on the next message, so what must outlast it belongs under `/home/agent` (your `/etc/AGENTS.md` says what else survives).

The machine admits its gateway and nothing else: the guest's egress allowlist names the gateway's address — or one host port when the runner is outside the cluster — and that address may itself be private.
`NO_PROXY` names `localhost`, `127.0.0.1`, `::1`, `100.64.0.0/10`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16` and `169.254.0.0/16`, so a client dialing one of those private ranges goes around the gateway, and nothing but the gateway is admitted there.
Loopback is this machine: a failure on `localhost` is a local service (the model router answers on `127.0.0.1`), not egress.

## Everything leaves through the gateway

`HTTPS_PROXY` and `HTTP_PROXY` name the gateway that fronts your sandbox, and for every host outside `NO_PROXY` it is the only way out.
On the way out it injects the real credential for every host your Connections cover, re-signs S3-compatible storage requests with the Connection's keys, meters model calls, and decides every other host against the rules that apply to your traffic — this agent's, or the rules of the agent that started you as a sub-agent, or the Owning Agent's when you are an Environment.

On HTTPS it **inspects** only some hosts: those a Connection covers, and those a rule narrows by method, path or port.
For every other host it sees the name alone.
Plain HTTP carries its method and path to it on every host.
That is why the same "it fails" has different shapes below.

## Blocked, waiting, or down

| what you see                                                                                                                                             | what it can mean                                                                                                                                                                                                                                                      |
| -------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `403`, header `x-platform-refusal: egress`, body `Blocked by network rule "deny …": the egress gateway refused this request to <host>, not the upstream` | a rule denies this host, this method, path or port on it. That body means the gate saw the request itself, so it can name the rule; the owner changes it on the agent's Network access page.                                                                          |
| `403` with no body                                                                                                                                       | the platform's bare refusal — an unresolved identity, a malformed host, a `..` path, a turn with nobody to ask, an owner's refusal or a lapsed approval, or the gate failing — and an upstream's own empty `403` all look like this.                                  |
| the connection closes at once, or nothing comes back                                                                                                     | on a host the gate does not inspect, a deny, a refusal, a name that does not resolve and a host that is down look alike.                                                                                                                                              |
| silence for as long as you wait, then a close or a bare `403`                                                                                            | an unmatched host is likely held for an approval nobody answered (30 minutes by default). An upstream that accepts and then stalls looks the same; only the approval row on Home confirms it.                                                                         |
| a `502` or `503`                                                                                                                                         | the gateway could not reach the host — its DNS, the host itself, or a destination its egress policy may not dial — or the upstream answered `502`/`503` itself. The status alone does not distinguish them, and a private destination would still be a platform rule. |

Four more, one line each:

- A private address goes around the gateway (see above); only the gateway's own address is admitted.
  A public name that resolves to a private address is decided by the gate first, and only then may the gateway's egress policy refuse the connection.
- A bare IP address is matched as the literal host text, and held like any other unmatched host; an HTTPS client that sends no SNI is refused for a missing host.
- A turn driven from a chat channel is refused at once instead of held, when no interactive session is attached to answer for it.
- An approval that is not once writes a rule on the agent whose rules decided the request — this one, or the agent that started you as a sub-agent.
  "Allow once" writes nothing.

If every host fails the same way, one rule can be the cause: a `deny` rule for `*` covers every host.
Look at the agent's Network access page before calling the gateway broken.
A gateway that is failing is a different thing, and the app shows it next to the agent as `Network access is failing`.

Once the cause is a host no rule covers, ask for the rule from here: the `egress_proposal` tool on the `platform-outbound` MCP server.
`propose` takes `host` and a one-sentence `reason`; `method` and `path` default to `*`, and a proposal without `port` speaks only for 443 over TLS or 80 over plain HTTP, so name the port for anything else.
`status` with its `id` answers pending, allowed, declined or expired after seven days; `already-allowed` means a rule already covers that shape.
Only the owner's verdict writes a rule, and it writes on the rules of the agent that asked.
When another agent's rules decide your traffic — you were started as a sub-agent, or you are an Environment — a proposal from here does not change them: report the host to the agent whose rules decide it, your driver or the Owning Agent.

## Credentials arrive as placeholders

No Connection credential is mounted in your sandbox.
What an integration hands you — an env var, `~/.aws/credentials`, gh's hosts file, a kubeconfig under `$HOME/.kube`, an MCP entry's headers — is a placeholder such as `platform:conn:<id>`, or `as-platform:conn:<id>` where a client demands a prefix; the gateway swaps in the real credential on the wire.
The Secret itself is on the gateway pod, never yours.
Env the owner typed into this agent arrives as written, not as a placeholder.
`platform-github` and `platform-s3` say where their integration keeps its credential and how to see what you hold.

Two cautions before you conclude anything:

- Finding no placeholder is not proof that nothing was granted: each integration keeps it in its own place, and a grant does not mean this request used it.
- Finding one is not proof that the gateway injected it, or that the service accepted it.

If a tool reports no credential, ask instead of hunting, with the `connection_secret` tool on the `platform-outbound` MCP server.
`options` lists the templates you may ask for and the Connections that already hold a secret; `request` with `templateId`, `name` and `inputs` (a new Connection) or `connectionId` (a new secret) returns a one-time link for the owner alone, valid for ten minutes; `status` with `requestId` says pending, saved, cancelled or expired.
Hand over the link and never ask for a secret in chat.
Only `x-platform-refusal: egress` says the platform refused under a rule.
Without it, a `401` or `403` may come from the gateway — a request that names no Connection, an out-of-bucket S3 request, a bare denial — or from the service refusing the credential, and the status alone does not say which.
Report the status and body; the owner checks for the integration's own gateway refusals before replacing a Connection.

## Docs and source

The platform is open source: source, docs and issues are at `github.com/dam-agents/dam`, which a new agent's default rules allow, so it is reachable with no approval.

- `docs/architecture/` — one page per subsystem, the source of truth for behaviour.
  Read `credential-gateway.md` for the gateway's mechanics, `security-and-credentials.md` for the egress gate, its holds and its rules, `connections.md` for what a Connection is and what a grant produces, and `vm-runner.md` for the machine around you.
- The code behind the messages above: `packages/controller/pkg/reconciler/envoy_bootstrap.go` renders the gateway, `packages/api-server/src/modules/approvals/services/ext-authz-gate.ts` makes each allow, deny and hold decision, `packages/vm-runner/src/` builds and boots the machine, and `packages/agents/base/rootfs/` is this image's base.

Read them to explain a cause, not to change the platform from in here: the owner makes those changes.

## The one local check

Two HTTPS requests from a terminal in this sandbox: the one that fails, and one the default rules allow.

```sh
curl -sS -o /dev/null -D - --suppress-connect-headers --max-time 20 -X <METHOD> "https://<host><path>"; echo "exit=$?"
curl -sS -o /dev/null -D - --suppress-connect-headers --max-time 20 https://registry.npmjs.org/; echo "exit=$?"
```

`--suppress-connect-headers` hides the proxy's own `200`, which the gateway sends whenever it accepts the tunnel and says nothing about the host.
A control that answers proves the sandbox and the gateway carry traffic; it says nothing about the other request.

- `403` with `x-platform-refusal: egress` → a rule denies it.
  Repeat the same request, same method and quoted URL, only showing the body: `curl -sS --max-time 20 -X <METHOD> "https://<host><path>"`.
  The body names the rule; report it.
- a bare `403`, a close, or nothing → the platform refused it, an upstream did, the name did not resolve, or the host is down; the response does not say which.
  Home's approval queue and, with the owner, the agent's Network access page are where the difference shows.
- the failing request times out while the control answers → a held approval is the likely reason.
  Look for a pending approval on Home naming that host (on a host the gate does not inspect, the host alone), and only then tell the owner to answer it; `--max-time` bounds the whole request, so an upstream that accepts and then stalls ends the same way.
- a `502` or `503` → the gateway could not reach the host (its DNS, the host itself, or a destination its egress policy may not dial), or the upstream answered `502`/`503` itself; the status does not distinguish them.
- both time out → the control proves nothing; use a host you have already reached from this sandbox as the control instead.

An unmatched request files an approval, so the owner may see one on Home; an identical retry joins it rather than filing another.
`--max-time 20` is deliberate: an unapproved request is held far longer than that, and you should not wait.
