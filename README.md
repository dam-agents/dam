<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/dam-light.svg" />
    <source media="(prefers-color-scheme: light)" srcset="docs/assets/dam-dark.svg" />
    <img src="docs/assets/dam-dark.svg" width="150" alt="DAM" />
  </picture>
</p>

<h3 align="center">
  The open platform for running AI agents: any harness, any model, on Kubernetes
</h3>

<p align="center">
  DAM provides the infrastructure for running agents securely and at scale:
  isolated sandboxes, credential isolation, durable workspaces, orchestration,
  scheduled and Slack based triggers, and cost visibility.
</p>

<p align="center">
  <a href="https://ibm.biz/dam-docs"><strong>Documentation</strong></a>
  ·
  <a href="https://ibm.biz/dam-agents"><strong>Launch DAM</strong></a>
  ·
  <a href="https://ibm.biz/dam-waitlist"><strong>Join the Waitlist</strong></a>
</p>

<p align="center">
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/badge/license-Apache--2.0-blue.svg" /></a>
  <img alt="Kubernetes" src="https://img.shields.io/badge/runs%20on-Kubernetes-326ce5" />
</p>

---

## Why DAM?

Every team running agents ends up building the same infrastructure. DAM provides it as a platform.

* **🛡️ Security enforced by infrastructure.** Agents run in isolated sandboxes with no credentials or cluster access. A paired gateway injects credentials and is the only network exit, enforced by Kubernetes NetworkPolicy. Risky actions can require human approval.

* **🔋 Always on.** Agents run in the cluster and continue working after your laptop closes. Persistent workspaces preserve files, memory, and learned context across restarts and long running sessions.

* **🤝 Built for teams.** Agents can live in Slack or Telegram and be shared across teammates. The web UI and `dam` CLI connect to the same live sessions.

* **🧠 Any harness, any model.** Use Claude Code, Codex, Pi Agent, Bob, or any ACP compatible runtime with your own model endpoints.

* **💸 Know what agents cost.** See usage and cost by user, agent, harness, and model, with an activity trail showing what ran and when.

* **🔀 Agents can work together.** Agents can spawn subagents on different harnesses or models, split work across them, and compare or review their results.

---

## One platform, many uses

DAM provides primitives that teams can combine for different workflows.

### Software engineering

Build software factories, PR review agents, automated debugging workflows, and cross harness evaluations.

The DAM team runs agents such as **software factory**, which takes a PRD through the backlog toward merged code, **code guardian**, which reviews pull requests and follows up on unresolved comments, and **buggy**, which turns obvious development issues into pull requests.

Agents can also collaborate directly. Give the same task to Claude Code and Codex, compare results and cost, or use one model to plan, another to implement, and another to review.

### Experiments & research

Run different harnesses and models side by side with persistent environments, isolation, telemetry, cost visibility, subagent workflows, and shareable artifacts.

### Assistants

Run personal and team agents in Slack that maintain context, respond to messages, file issues, and wake up on schedules.

### Knowledge bases

Use agents to maintain team knowledge instead of maintaining a wiki manually. Agents can turn meetings, feedback, and discussions into durable, linked knowledge.

---

## The building blocks

| Block                   | What it provides                                                                     |
| ----------------------- | ------------------------------------------------------------------------------------ |
| **Harnesses**           | Claude Code, Codex, Pi Agent, Bob, or any ACP compatible runtime                     |
| **Models**              | AWS Bedrock, internal gateways, LiteLLM, open weight models, and other endpoints     |
| **Security**            | Isolated agents, credential isolation, network controls, and optional human approval |
| **Cost & budgets**      | Per user and per agent visibility, budgets, telemetry, and activity history          |
| **Subagents**           | Spawn agents across harnesses and models with typed, schema checked results          |
| **Skills**              | Team conventions and workflows packaged in git and shared across agents              |
| **Workspaces & memory** | Persistent disks for files, memory, and learned context                              |
| **Artifacts**           | Durable, organized results that can be shared independently of the agent             |
| **Schedules**           | Agents that wake on timers for recurring work                                        |
| **Channels**            | Slack, Telegram, web UI, and CLI access to live agent sessions                       |

---

## Supported harnesses

| Harness         | Description                                         |
| --------------- | --------------------------------------------------- |
| **Claude Code** | Coding agent for complex software engineering tasks |
| **Codex**       | Coding agent for end to end implementation          |
| **Pi Agent**    | Multi provider coding harness                       |
| **Bob**         | Enterprise coding assistant for IBM workflows       |

Bring your own harness with [ACP](https://agentclientprotocol.com/get-started/introduction). ACP compatible runtimes can use DAM's platform capabilities without a custom adapter.

---

## Run your own

DAM is Apache 2.0 licensed and can be deployed on your own Kubernetes cluster using Helm.

```sh
helm install platform oci://quay.io/dam-agents/charts/platform --version 0.2.16
```

The chart includes Keycloak, Postgres, Redis, and an optional telemetry backend.

Configure harness templates, model endpoints, credentials, budgets, and isolation in [`values.yaml`](deploy/helm/platform/values.yaml).

DAM requires an Istio ambient mesh. Before deploying to production, read [`docs/architecture.md`](docs/architecture.md) and [`docs/architecture/security-and-credentials.md`](docs/architecture/security-and-credentials.md).

---

## For IBMers

IBM Research operates a hosted DAM deployment, so IBM employees do not need to run their own cluster.

|                    |                                                      |
| ------------------ | ---------------------------------------------------- |
| **Launch DAM**     | [ibm.biz/dam-agents](https://ibm.biz/dam-agents)     |
| **Documentation**  | [ibm.biz/dam-docs](https://ibm.biz/dam-docs)         |
| **Request access** | [ibm.biz/dam-waitlist](https://ibm.biz/dam-waitlist) |

The hosted deployment provides IBM internal model endpoints and integrations that are not included in the open source deployment.

---

<details>
<summary><strong>Developing DAM locally</strong></summary>

### Prerequisites

* [mise](https://mise.jdx.dev)
* Docker compatible runtime such as Docker Desktop, Rancher Desktop, or Colima
* macOS or Linux

Podman is not supported.

On Linux, install QEMU to run k3s in a VM, or set `IS_SANDBOX=1` when running directly in an existing VM.

### Setup

```sh
git clone https://github.com/dam-agents/dam
cd dam

mise install
mise run cluster:install
```

Open [localhost:4444](http://localhost:4444) and log in with:

```txt
username: dev
password: dev
```

Create an instance from a template and start chatting with your agent.

See [`docs/guidelines/work-process.md`](docs/guidelines/work-process.md) for the contributor workflow and [`CLAUDE.md`](CLAUDE.md) for engineering conventions.

</details>

---

## Built in the open

DAM is developed in the open. Issues, pull requests, roadmap decisions, and development all happen in this repository.

See the [GitHub issues](https://github.com/dam-agents/dam/issues) to follow the work, report problems, or contribute.
