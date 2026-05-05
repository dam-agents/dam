# DAM — Pitch

## Contents

- [So you want to run an agent in production](#so-you-want-to-run-an-agent-in-production)
- [Meet DAM](#meet-dam)
- [The mental model](#the-mental-model)
- [The 5-minute tour](#the-5-minute-tour)
- [Party tricks](#party-tricks)
- [What you build on top](#what-you-build-on-top)

## So you want to run an agent in production

You've got this beautiful thing. Claude Code, Codex, Gemini CLI — pick your poison. On your laptop it's magic: ships PRs at 2am, drafts PRDs from Slack threads, triages the backlog before standup.

You tuned it. It works. Now you want it to keep working when you close the lid.

And you have a list.

**It's not safe.**
- The agent has an API key in an env var. One `echo $ANTHROPIC_API_KEY` away from a log. One prompt injection away from someone else's log.
- The agent has bash — that's the point of a harness. Now it has your SSH keys, your `.env` files, and the ability to `curl | sh` anything it wants. Congratulations — your agent is a Unix admin.

**It can't leave your laptop.**
- You write a cron for 9am. Your laptop is asleep. The cron doesn't run.
- Every session starts from zero. The agent doesn't remember you, your team, or what you told it yesterday.
- It lives in a terminal. Your team is in Slack. Your family is in Telegram. The agent can't reach them.

**It can't become a product.**
- Your colleagues want one too. Now you need auth, isolation, per-user credentials, per-user state. You thought you were building an agent. You're now building a SaaS.
- Six months from now, someone ships a better model. Your setup is bolted to one SDK, one harness, one cloud. Migrating is a weekend.

None of this is the harness's fault. Harnesses are great at being harnesses. They're bad at being production systems because that was never their job.

DAM signed up for that job.

## Meet DAM

DAM is Kubernetes for agent harnesses. You bring the harness. DAM gives it an isolated pod, a credential gateway, a cron, a workspace that survives restarts, and a way to reach Slack.

**Isolated** is doing real work in that sentence. Each agent gets its own Linux process, its own filesystem, its own network, its own credentials. Not N agents sharing one runtime. Not N threads in a long-running Python process. Not N tabs in one browser. A real OS-level boundary per agent, by default, because that's what Kubernetes gives you when you use it honestly.

The harness doesn't know any of that is happening. It runs the same way it ran on your laptop. It just keeps running.

Here's the mapping to the three problems:

| The problem | DAM's answer |
|---|---|
| Credentials and bash | Every pod ships with an Envoy credential-gateway sidecar. Real tokens live in K8s Secrets that are mounted only into the sidecar — never the agent container. Outbound traffic terminates at the sidecar, which injects the credential header on the wire. Network policy drops everything else. If the agent is compromised, there's nothing to steal. |
| Can't leave your laptop | Cron lives on the platform, not your laptop. Schedules fire as trigger files in `/workspace/.triggers/` — the harness can't tell a cron fire from a human message. Workspace persists on a PVC across hibernation; conversation history comes back on wake. Slack is a first-class channel. |
| Can't become a product | Every instance is a ConfigMap. Multi-tenant by construction. Harness-agnostic and model-agnostic — anything that speaks ACP works. No CRDs, so no cluster-admin required. |

**DAM has no opinions about your agent.** No memory format, no skill system, no prompt templates, no dashboards for tuning. Opinions belong in the product layer — that's where things like dam-claw live. DAM is the platform. dam-claw is one app that runs on it. This document is about the platform.

## The mental model

DAM runs agents using three K8s primitives.

**Template** — a blueprint for a kind of agent. A ConfigMap that says *"use this image, mount these paths, run this init script, allocate this much CPU/memory."* The template is the class. `claude-code` is the one DAM ships.

**Instance** — a specific agent you've spun up from a template. Also a ConfigMap. Carries the instance name, the secret reference, any per-instance overrides. Template is the class; instance is the object. Ten users, ten instances, one template.

**Pod** — what actually runs. DAM's controller turns each instance into a StatefulSet with `replicas: 1` and a PVC per persistent mount. StatefulSet means `demo-0` is *always* `demo-0` — same pod name, same PVC, same workspace, across restarts and hibernation. `replicas: 0` = hibernated, disk preserved. `replicas: 1` = running, disk remounted. That's the whole hibernate/wake story.

**Pods are disposable; workspaces are not.** Anything outside `/workspace` and `/home/agent` is wiped on restart. That's a feature: bad state can't survive a reboot, and you can recover from almost any pod-level failure by killing it. The constraint: system-level changes (apt, `/etc` edits) don't stick. `$HOME`-scoped installs (`npm install -g`, `uv tool install`) do — that's what `/home/agent` persistence is for. Heavier stuff goes in the template image.

**Each instance is its own.** Two instances in the same cluster can't see each other — no shared memory, no shared disk, no shared network namespace. One agent's crash doesn't touch others. One agent's compromise doesn't leak beyond its own pod. One agent's `rm -rf` hurts only itself.

None of this uses CRDs. Every DAM resource is a plain ConfigMap with a `platform.ai/type` label:

```sh
mise run cluster:kubectl -- get cm -l platform.ai/type -A
```

So you can inspect, edit, diff, and back up DAM state with `kubectl` alone. No cluster-admin required to install. That's not a quirk — it's the entire reason DAM is namespace-scoped by design.

## The 5-minute tour

Prerequisites: [mise](https://mise.jdx.dev), Docker, Mac or Linux.

```sh
mise install                # toolchain + deps + git hooks
mise run cluster:install    # k3s in lima, deploys DAM
export KUBECONFIG="$(mise run cluster:kubeconfig)"
```

That booted a local k3s cluster and deployed the whole stack: Keycloak, Postgres, controller, API server, UI, and a default Claude Code template called `claude-code`.

**Log in.** Everything uses `dev` / `dev` for local installs (seeded by `values-local.yaml`). Same login for both UIs.

**Create an instance.** Open `http://dam.localhost:4444`, pick the `claude-code` template, give it a name (e.g. `demo`). In ~20 seconds the pod is ready.

**Drop a credential into DAM.** Open `http://dam.localhost:4444` → Connections → Add Secret. Pick **Anthropic**, paste the output of `claude setup-token`. Save.

**Chat.** Open the instance in DAM, type a message. You're done.

## Party tricks

Some demos of what's actually happening in your cluster.

### 1. The agent has no secrets

```sh
mise run cluster:kubectl -- exec -n platform-agents <pod> -- \
  sh -c 'env | grep -iE "anthropic|api_key|token" || echo "no real creds visible"'
```

The env has only the agent-runtime auth token. No real API keys, no upstream credentials. Prompt injection can't leak what isn't there.

### 2. The agent can't reach the internet directly

```sh
mise run cluster:kubectl -- exec -n platform-agents <pod> -- \
  node -e "require('net').connect(443,'api.anthropic.com').setTimeout(3000)
    .on('connect',()=>console.log('CONNECTED (unexpected)'))
    .on('timeout',()=>console.log('BLOCKED: timeout'))
    .on('error',e=>console.log('BLOCKED:',e.code))"
```

`BLOCKED`. The NetworkPolicy forces all 80/443 egress through the in-pod Envoy sidecar and DNS. Kernel-level, enforced by the CNI — not something the agent can talk its way past.

### 3. The only working route is the sidecar — and it knows who you are

Put those two together: no credentials, no route out except the sidecar. The chat still worked — Envoy identified the agent's owner, mounted their credential Secret, injected the header on the wire, forwarded. That's the security model. Not "we trust the agent." Structural. [Read the full security model →](docs/strategy/security-model.md)

### 4. Pod killed, session restored

Kill the pod:

```sh
mise run cluster:kubectl -- delete pod -n platform-agents <pod>
```

Kubernetes replaces it. New pod, same name, same PVC, same conversation history. Wait ~20 seconds and chat again — your earlier messages are still there.

That's not resilience you configured. It's StatefulSet + per-instance PVC + DB-backed sessions acting in concert. Pod crashes, image rollouts, node evictions — all survived.

### 5. Two agents can't see each other

Create a second instance in the UI (call it `other`). From the first:

```sh
mise run cluster:kubectl -- exec -n platform-agents <pod> -- \
  node -e "require('net').connect(8080,'other-0.other.platform-agents.svc').setTimeout(3000)
    .on('connect',()=>console.log('CONNECTED (unexpected)'))
    .on('timeout',()=>console.log('BLOCKED: timeout'))
    .on('error',e=>console.log('BLOCKED:',e.code))"
```

`BLOCKED`. The egress NetworkPolicy permits the in-pod Envoy sidecar (which talks to upstreams), the api-server's harness and ext_authz ports, and DNS — nothing else. Another instance, the Kubernetes API, Postgres, Keycloak — all unreachable from agent pods. Per-instance isolation without per-instance configuration.

## What you build on top

Four things that become possible once the floor is there.

**1. Personal AI employees.** Non-technical users "hire" opinionated templates — a trip planner, a family assistant, a meal planner — the way you'd hire a human. Conversation happens wherever they already are — Telegram, Slack, whatever — not a dashboard. Each hire runs permanently, remembers you across sessions, and acts proactively on a schedule. This is what dam-claw is being built to do.

**2. The morning team brief.** A scheduled agent that scans Slack and GitHub every morning and sends a team lead their situational awareness DM: who's unblocked, who's stuck, what's at risk. Read-only. Replaces a workflow that experienced PMs do manually — except this one runs at 7am whether you're online or not.

**3. The codebase guardian.** An agent that scans your repo on a schedule, detects drift in `README.md` / `CLAUDE.md` / architecture notes, posts proposed edits to your team channel. When a human responds, the agent opens a PR **under that person's GitHub identity** — not a shared bot account. Whoever approves authored it. Accountability is structural, same as DAM's credential story.

**4. The agent you sell.** You're shipping an agent as a product — a support triage bot, a release-notes writer, a translator that lives in somebody else's Jira. Every customer gets their own isolated pod, their own credentials, their own schedule. The SaaS plumbing from Section 1 is already in the box.
