---
name: platform-environment
description: >
  Use whenever something fails for a reason the platform, not the code, may own — a request that hangs or closes with no answer, a 403 whose body says the egress gateway refused it, a tool with no credential, a model call the provider rejects — and when you need to know where you are running or where the platform's docs and source are.
  Covers the sandbox you run in (a container pod or a microVM, the same image either way), the gateway every outbound request passes through, which failures it can explain and which it cannot, how credentials reach you as placeholders instead of keys, and one local check that separates a refused host from an unreachable one.
---

You are running inside a Platform sandbox.
Nothing reaches the internet except through the platform's gateway, and no Connection credential is in here to find.
Many "it does not work" answers are one of those two facts.

## Where you are

Platform runs each agent in an isolated sandbox built from this image: **a container pod**, or **a microVM** on the owner's VM runner.
Either way it is the same image, the same home (`/home/agent`) and the same rules in front of it, so everything below holds for both.
A microVM sets `PLATFORM_BACKEND=vm`; a container leaves it unset.
The sandbox sleeps when idle and comes back on the next message, so what must outlast it belongs under `/home/agent` (your `/etc/AGENTS.md` says what else survives).

The two runtimes differ in one way that matters here: in a microVM the private ranges are in `NO_PROXY`, so the guest reaches its own network directly and only public hosts go through the gateway.
In a container nothing private is reachable at all.

## Everything leaves through the gateway

`HTTPS_PROXY` and `HTTP_PROXY` name the gateway that fronts your sandbox, and it is the only way out: the cluster admits no other route.
On the way out it injects the real credential for every host your Connections cover, re-signs S3-compatible storage requests with the Connection's keys, meters model calls, and decides every other host against the rules that apply to your traffic — this agent's, or the rules of the agent that started you as a sub-agent, or the Owning Agent's when you are an Environment.

It **inspects** only some hosts: those a Connection covers, and those a rule narrows by method, path or port.
For every other host it sees the name alone.
That is why the same "it fails" has different shapes below.

## Blocked, waiting, or down

| what you see                                                                                                                                             | what happened                                                                                                                                                                         |
| -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `403`, header `x-platform-refusal: egress`, body `Blocked by network rule "deny …": the egress gateway refused this request to <host>, not the upstream` | a rule denies this host, or this method, path or port on it. Only an inspected host can tell you this much. The owner changes the rule on the agent's Network access page.            |
| `403` with no body                                                                                                                                       | the platform refused without a rule: a turn driven from a chat channel with nobody to ask, or a path holding a `..` segment. Nothing was contacted.                                   |
| the connection closes at once, or nothing comes back at once                                                                                             | on a host the platform does not inspect, a deny, a refusal, a name that does not resolve and a host that is down all look like this. Nothing in here tells them apart.                |
| silence for as long as you wait, then a close or a bare `403`                                                                                            | no rule covers the host: the platform filed an approval and held the request, and nobody answered or the owner refused. The approval stays answerable for 30 minutes by default.      |
| a `502` or `503`                                                                                                                                         | the request passed the checks and the gateway could not reach the host: its DNS, the host itself, or a private address the gateway may not dial, which arrives in about five seconds. |

Four more, one line each:

- A private address — `10.0.0.0/8`, `100.64.0.0/10`, `127.0.0.0/8`, `169.254.0.0/16`, `172.16.0.0/12`, `192.168.0.0/16`, or the cloud metadata endpoint — is dropped by the gateway's own egress policy, so it fails in about five seconds, unless the install opened that range.
- A bare IP address is refused at once: TLS to an address carries no name for the gateway to match.
- A turn driven from a chat channel is refused at once instead of held, when no interactive session is attached to answer for it.
- An approval that is not once writes a rule on the agent whose rules decided the request — this one, or the agent that started you as a sub-agent.
  "Allow once" writes nothing.

If every host fails the same way, egress itself is broken rather than one host.
Retry once, then tell the owner: the platform keeps the sandbox running while egress is down, and the app shows it next to the agent as `Network access is failing`.

## Credentials arrive as placeholders

No Connection credential is mounted in your sandbox.
What you hold — in an env var, in `~/.aws/credentials`, in `~/.config/gh/hosts.yml` — is a placeholder such as `platform:conn:<id>`, or `as-platform:conn:<id>` where a vendor's client demands a prefix, and it names the Connection whose credential the gateway swaps in on the wire.
The Secret itself is mounted on the gateway pod, never yours.

Env the owner typed into this agent's settings is the exception: it arrives as written and is not a placeholder.

So: never hunt for a key, never paste one, never run `gh auth login`, `aws configure` or set `AWS_ACCESS_KEY_ID`.
A pasted credential bypasses the platform and either gets lost or leaks.
`platform-github` and `platform-s3` describe each integration's placeholder and how to pick between several accounts or profiles.

When a credential fails, report what you can see — the tool has no credential at all, or the service answered 401 or 403 — and stop there: the owner connects the integration in the app and grants it on the agent's Connections page.
Two greps say which of the two it is, and neither prints a secret:

```sh
env | grep 'platform:conn:'
grep -r 'platform:conn:' ~/.aws/credentials ~/.config/gh/hosts.yml
```

A placeholder for the integration means the grant is there and the service is refusing the real credential; no placeholder at all means this agent holds nothing for it, so the platform has nothing to inject.

## Docs and source

The platform is open source: source, docs and issues are at `github.com/dam-agents/dam`, which a new agent's default rules allow, so it is reachable with no approval.

- `docs/architecture/` — one page per subsystem, the source of truth for behaviour.
  Read `credential-gateway.md` for the gateway's mechanics, `security-and-credentials.md` for the egress gate, its holds and its rules, and `connections.md` for what a Connection is and what a grant produces.
- The code behind the messages above: `packages/controller/pkg/reconciler/envoy_bootstrap.go` renders the gateway, `packages/api-server/src/modules/approvals/services/ext-authz-gate.ts` makes each allow, deny and hold decision, and `packages/agents/base/rootfs/` is this image's base.

Read them to explain a cause, not to change the platform from in here: the owner makes those changes.

## The one local check

Two requests from a terminal in this sandbox: the request that fails, with its own method and path, then one that should answer anyway.

```sh
curl -sS -o /dev/null -D - --suppress-connect-headers --max-time 20 -X <METHOD> "https://<host><path>"; echo "exit=$?"
curl -sS -o /dev/null -D - --suppress-connect-headers --max-time 20 https://registry.npmjs.org/; echo "exit=$?"
```

`--suppress-connect-headers` hides the proxy's own `200`, which the gateway sends whenever it accepts the tunnel and says nothing about the host.
On an agent with the default rules the second request is allowed, so it separates "the platform decided" from "the network is broken":

- `403` with `x-platform-refusal: egress` → a rule blocks it.
  `curl -sS --max-time 20 https://<host><path>` prints the body, which names the rule; report that.
- `403` with no body → refused without a rule, so the path or the kind of turn is the cause.
- `exit=28` (timed out, nothing back) on the failing request while the second one answers in a second → the platform is holding it for an approval.
  The sandbox and the gateway are proven fine, so the cause is a platform decision, not the network: the owner answers it on Home, or allows the host on the agent's Network access page.
- `exit=35`, `exit=56`, or nothing comes back → the gateway or the upstream closed the connection.
  On a host the platform does not inspect, that is a rule, a refusal, a name that does not resolve or a host that is down, and you cannot tell which from here; the agent's Network access page lists every rule, so the owner can.
  A close after a wait, rather than at once, is a held approval the connection gave up waiting for.
- a `502` or `503` → the request left the platform and the upstream or its DNS failed: the host is down, not blocked.
- `exit=28` on both → the control proves nothing; use a host you have already reached from this sandbox as the control instead.

The probe files an approval, so the owner may see it on Home, and an identical retry joins it rather than filing another.
On an inspected host the approval names the method and path; on a host the platform does not inspect it names the host alone, because the gateway never saw the request.
`--max-time 20` is deliberate: an unapproved request is held far longer than that, and you should not wait.
