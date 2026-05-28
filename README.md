<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/dam-light.svg" />
    <source media="(prefers-color-scheme: light)" srcset="docs/assets/dam-dark.svg" />
    <img src="docs/assets/dam-square-dark.svg" width="150" alt="DAM" />
  </picture>
</p>

<h3 align="center">
  Run agent harnesses like Claude Code headless in the cloud.
</h3>

<p align="center">
  <a href="https://ibm.biz/dam-docs"><strong>Documentation</strong></a>
  ·
  <a href="https://ibm.biz/dam-agents"><strong>Launch DAM</strong></a>
  ·
  <a href="https://ibm.biz/dam-waitlist"><strong>Join the Waitlist</strong></a>
</p>

---

## Why DAM?

- ☁️ **Runs in the cloud.** Agents execute continuously in the cloud and keep running after you close your laptop or go offline.
- 🔐 **Isolated execution.** Each agent runs in an isolated container with all access routed through a policy-enforced gateway.
- 🔑 **Zero trust credentials.** Connect agents to your tools without exposing credentials to the runtime.
- 👥 **Built for teams.** Collaborate in Slack and run agents on schedules for recurring workflows.

---

## Ways to Use DAM

| Mode | Description |
|---|---|
| **Web UI** | Chat with your agent, stream its terminal, and manage files — all from the browser. |
| **CLI** | Create agents, attach to live sessions, and manage instances from your local terminal. |
| **Slack** | Message your agent from Slack threads. Teammates interact with their own credentials. |
| **Schedules** | Run agents on a recurring timer — daily code reviews, nightly audits, continuous monitoring. |

---

## Supported Agent Harnesses

| Harness | Description |
|---|---|
| **Claude Code** | Reasoning-first assistant for complex coding tasks. |
| **Pi Agent** | Multi-provider coding harness across leading LLMs. |
| **Bob** | Enterprise coding assistant for IBM workflows. |
| **Codex** | Execution-first system for end-to-end coding tasks. |

Bring your own harness — any runtime compatible with [ACP](https://agentclientprotocol.com/get-started/introduction) can run on DAM.

---

## Get Started

Head to [ibm.biz/dam-agents](https://ibm.biz/dam-agents), create an instance from a template, and start chatting. 

See the [documentation](https://ibm.biz/dam-docs) for quickstarts, core concepts, integration guides, and use cases.

---

<details>
<summary><strong>Developing DAM locally</strong></summary>

For contributors working on the DAM platform itself.

### Prerequisites

- [mise](https://mise.jdx.dev)
- Docker-compatible runtime (Docker Desktop, Rancher Desktop, etc.)
- macOS or Linux

### Local Setup

```sh
git clone https://github.com/dam-agents/dam && cd dam

mise install
mise run cluster:install
````

Open [localhost:4444](http://localhost:4444) and log in with:

```txt
username: dev
password: dev
```

Create an instance from a template and start chatting with your agent.

See [work process](docs/guidelines/work-process.md) for the contributor workflow.

</details>
