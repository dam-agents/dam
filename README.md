<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/dam-light.svg" />
    <source media="(prefers-color-scheme: light)" srcset="docs/assets/dam-dark.svg" />
    <img src="docs/assets/dam-square-dark.svg" width="150" alt="DAM" />
  </picture>
</p>

<h3 align="center">
  The open platform for running AI agents: any harness, any model, on Kubernetes
</h3>

<p align="center">
  DAM is the infrastructure no team should build themselves: isolated sandboxes, credentials the agent never holds, scheduled and Slack-native triggers, durable workspaces, and cost visibility. You build the use case. DAM runs it.
</p>

<p align="center">
  <a href="#run-your-own"><strong>Run your own</strong></a>
  ·
  <a href="docs/architecture.md"><strong>How it works</strong></a>
  ·
  <a href="#for-ibmers"><strong>IBMers: use our deployment</strong></a>
</p>

<p align="center">
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/badge/license-Apache--2.0-blue.svg" /></a>
  <img alt="Kubernetes" src="https://img.shields.io/badge/runs%20on-Kubernetes-326ce5" />
</p>

---

## Two ways to get DAM

DAM is Apache-2.0 licensed and self-hostable. Anyone can install it on a Kubernetes cluster. See [Run your own](#run-your-own).

IBM Research also operates a hosted deployment for IBM employees. See [For IBMers](#for-ibmers).

---

## Why DAM?

Every team that runs agents rebuilds the same infrastructure. DAM builds it once.

- **🛡️ Agents run on your terms.** Your cluster, your model endpoints, your data. An agent pod holds no credentials and no cluster access. A paired gateway injects credentials and is the only network exit, enforced by Kubernetes NetworkPolicy rather than by the agent behaving well. Risky actions can wait for a human.

- **🔋 Always on, and they remember.** Agents live in the cluster. They wake on a schedule or a message, keep working after your laptop closes, and keep files, memory, and learned context on a durable volume across restarts and months of use.

- **🤝 Your whole team, one agent.** Agents live in Slack or Telegram, so teammates can share the same agent and its context. The web UI and `dam` CLI connect to that same live session.

- **Any harness, any model.** Claude Code, Codex, PI Agent, and IBM Bob ship as templates. Point them at Bedrock, an internal gateway, LiteLLM, or open-weight endpoints. Platform features are harness-agnostic, so swapping the agent does not cost you the platform.

- **💸 See what it costs.** Per-agent and per-model token and cost reporting from the bundled telemetry backend, plus an append-only activity log for "who ran what".

---

## The building blocks

| Block | What it gives you |
|---|---|
| **Harnesses** | Claude Code, Codex, Pi, Bob, or any [ACP](https://agentclientprotocol.com/get-started/introduction)-compatible runtime. One protocol, so every platform feature works on every harness. |
| **Models** | Your endpoints: AWS Bedrock, internal gateways, open-weight models. Pick per agent, mix across agents, compare. |
| **Security** | Agents hold no secrets and no cluster access. A gateway injects credentials and is the only network exit; humans approve risky actions; clusters that support it can give each agent its own VM. |
| **Cost & budgets** | Per-user and per-agent spend visibility, budgets, and a full audit trail. |
| **Subagents** | A running agent spawns agents on any harness and gets back typed, schema-checked results. A subagent can never carry more access than its parent. |
| **Skills** | Your team's conventions and workflows, packaged once in git, installed by every agent, improved by pull request. |
| **Workspaces & memory** | Every agent owns a persistent disk. Its files, memory, and learned context survive restarts, sleep, and months of use. |
| **Artifacts** | Results that outlive the agent that made them: versioned, organized, shareable by link with people who have no account. |
| **Schedules** | Agents that wake on a timer: nightly audits, daily reviews, continuous monitoring. |
| **Channels** | Agents live in your team's Slack, and each teammate interacts with their own credentials. Web UI and CLI attach to the same live session. |

Deeper detail per subsystem: [`docs/architecture.md`](docs/architecture.md).

---

## Run your own

DAM installs on any Kubernetes cluster via Helm. Container images and the chart are public on `quay.io/dam-agents`.

```sh
helm install platform oci://quay.io/dam-agents/charts/platform --version 0.2.16
```

The chart brings its own Keycloak, Postgres and Redis, and an optional bundled telemetry backend. Configure harness templates, model endpoints, credential sets, per-user budgets and isolation level in [`values.yaml`](deploy/helm/platform/values.yaml) — it is the reference for every option, and it is heavily commented.

Requires an Istio ambient mesh in the cluster. Read [`docs/architecture.md`](docs/architecture.md) before a production install; [`docs/architecture/security-and-credentials.md`](docs/architecture/security-and-credentials.md) describes the trust boundary you are relying on.

<details>
<summary><strong>Developing DAM locally</strong></summary>

For contributors working on the DAM platform itself.

### Prerequisites

- [mise](https://mise.jdx.dev)
- Docker-compatible runtime (Docker Desktop, Rancher Desktop, Colima, etc.) -- note that Podman is _not_ supported
- macOS or Linux
- on Linux, either:
  - install QEMU if you want to run k3s in a VM (default), or
  - set environment variable `IS_SANDBOX=1` if you want to operate directly in the current OS, typically if it is already a VM

### Local Setup

```sh
git clone https://github.com/dam-agents/dam && cd dam

mise install
mise run cluster:install
```

Open [localhost:4444](http://localhost:4444) and log in with:

```txt
username: dev
password: dev
```

Create an instance from a template and start chatting with your agent.

See [work process](docs/guidelines/work-process.md) for the contributor workflow, and [`CLAUDE.md`](CLAUDE.md) for engineering conventions. Commits use Conventional Commits and require a DCO sign-off (`git commit -s`).

</details>

---

## For IBMers

IBM Research runs a hosted DAM deployment. You do not need a cluster.

| | |
|---|---|
| **Launch DAM** | [ibm.biz/dam-agents](https://ibm.biz/dam-agents) |
| **Documentation** | [ibm.biz/dam-docs](https://ibm.biz/dam-docs) |
| **Request access** | [ibm.biz/dam-waitlist](https://ibm.biz/dam-waitlist) |

Create an agent from a template and start chatting. The deployment adds IBM-internal model endpoints and integrations that the open-source chart does not ship, and IBM Bob needs IBM entitlement.

---

## Built in the open

Development happens here, in public. Issues, pull requests, and roadmap decisions are all part of the project.

Follow development, report issues, or start a discussion on [GitHub](https://github.com/dam-agents/dam/issues).

---

## Maintainers

This project is built and maintained by the DAM team.

<a href="https://github.com/dam-agents/dam">
  <img alt="DAM team" src="https://contrib.rocks/image?repo=dam-agents/dam" />
</a>
