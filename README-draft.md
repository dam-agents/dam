<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/dam-light.svg" />
    <source media="(prefers-color-scheme: light)" srcset="docs/assets/dam-dark.svg" />
    <img src="docs/assets/dam-square-dark.svg" width="150" alt="DAM" />
  </picture>
</p>

<h3 align="center">
  The open platform for running AI agents: any harness, any model
</h3>

<p align="center">
  DAM is the building blocks no team should be building themselves:
  security enforced by infrastructure, cost visibility and control, agent orchestration,
  durable memory, and governance. You focus on your use case, not the plumbing.
</p>

<p align="center">
  <a href="https://ibm.biz/dam-docs"><strong>Documentation</strong></a>
  ·
  <a href="https://ibm.biz/dam-agents"><strong>Launch DAM</strong></a>
  ·
  <a href="https://ibm.biz/dam-waitlist"><strong>Join the Waitlist</strong></a>
</p>

---

## Why DAM?

Every team that runs agents ends up hand-building the same plumbing. DAM builds it once, and lets you:

- **🛡️ Run agents on your terms.** Your cluster, your model endpoints, your data never leaves your boundary. Agents hold no credentials (a paired gateway injects them and is the only way out), and risky actions wait for a human. Enforced by infrastructure, not prompts, so it holds even when an agent is tricked.

- **💸 Keep cost under control.** See what every agent did and what it cost, per user and per agent. Set budgets, compare spend across harnesses and models, and answer "who ran what, for how much" from an audit trail instead of a spreadsheet.

- **🤝 Collaborate: humans with agents, agents with agents.** Your whole team works with the same agent in Slack, each person with their own credentials, and sessions follow you from web to CLI. Agents collaborate too: spawn subagents on any harness, split one task across models, and let them check each other's work.

- **🔋 Stay on, remember everything.** Agents live in the cloud: they wake on schedules and messages, keep working after your laptop closes, and keep their files, memory, and learned context on a durable disk for months.

---

## One platform, many uses

DAM ships primitives, not opinions about your end product. Teams point the same blocks at very different problems:

- **Software engineering**: assemble your own software factory, PR review agents, and cross-harness bake-offs. [↓ details](#software-engineering)
- **Experiments & research**: run harnesses and models side by side, with costs and telemetry to decide. [↓ details](#experiments--research)
- **Assistants**: personal and team agents that live in Slack and act on schedules. [↓ details](#assistants)
- **Knowledge bases**: team memory that maintains itself. [↓ details](#knowledge-bases)

---

## The building blocks

| Block | What it gives you |
|---|---|
| **Harnesses** | Claude Code, Codex, Pi, Bob, or any [ACP](https://agentclientprotocol.com/get-started/introduction)-compatible runtime. One protocol, so every platform feature works on every harness. |
| **Models** | Your endpoints: AWS Bedrock, internal gateways, open-weight models. Pick per agent, mix across agents, compare. |
| **Security** | Agents hold no secrets and no cluster access. A gateway injects credentials and is the only network exit; humans approve risky actions; production runs each agent in its own lightweight VM. |
| **Cost & budgets** | Per-user and per-agent spend visibility, budgets, and a full audit trail. |
| **Subagents** | A running agent spawns agents on any harness and gets back typed, schema-checked results. A subagent can never carry more access than its parent. |
| **Skills** | Your team's conventions and workflows, packaged once in git, installed by every agent, improved by pull request. |
| **Workspaces & memory** | Every agent owns a persistent disk. Its files, memory, and learned context survive restarts, sleep, and months of use. |
| **Artifacts** | Results that outlive the agent that made them: versioned, organized, shareable by link with people who have no account. |
| **Schedules** | Agents that wake on a timer: nightly audits, daily reviews, continuous monitoring. |
| **Channels** | Agents live in your team's Slack, and each teammate interacts with their own credentials. Web UI and CLI attach to the same live session. |

---

## What you build on it

### Software engineering

Build your own software factory, shaped by your process instead of someone else's. Agents running today on DAM, by the DAM team: **software-factory** takes a PRD and works the backlog to merged, one heartbeat at a time, pausing to Slack when stuck; **code-guardian** reviews every pull request and chases the ones humans forget (comments, never merges); **buggy** sweeps dev logs and turns obvious one-liners into PRs.

And because every harness and model has its own biases, DAM makes agent collaboration a first-class move: give the same task to Claude Code and Codex in parallel and compare the results and the cost. Plan with one model, implement with a second, review with a third. Let two agents refine each other's solution instead of refining it yourself.

### Experiments & research

Run harnesses and models side by side and let the numbers decide. Built with AI-native research teams, and shaped by their pain points: always-on hosted runs that survive any laptop, cost per run across every harness and model, telemetry to learn from, isolation strong enough for crown-jewel code, subagent topologies (fan-out, debate, pipelines), and artifacts that turn a run into a report you can send to anyone.

### Assistants

Personal and team agents that live where your team lives. Drop a half-formed complaint into the team's Slack channel: the agent has the thread's context, asks the one question that's missing, and ends the conversation with a filed issue. A schedule replaces remembering; the workspace remembers what any one conversation forgets.

### Knowledge bases

Agents that write and maintain your team's memory instead of you maintaining a wiki. **strategy-wiki** turns meetings and feedback into durable, linked pages at stable URLs, and notices when three teams report the same problem in different words.

---

## Get started

Your first ten minutes: create two agents from templates, one Claude Code and one Codex. Give both the same task. Watch both terminals side by side, compare the results, then open the cost view and see what each one spent. That's the platform in one exercise: any harness, any model, and the numbers to choose between them.

Head to [ibm.biz/dam-agents](https://ibm.biz/dam-agents) to create your first instance, and see the [documentation](https://ibm.biz/dam-docs) for quickstarts, core concepts, and integration guides.

---

## Supported harnesses

| Harness | Description |
|---|---|
| **Claude Code** | Reasoning-first assistant for complex coding tasks. |
| **Codex** | Execution-first system for end-to-end coding tasks. |
| **Pi Agent** | Multi-provider coding harness across leading LLMs. |
| **Bob** | Enterprise coding assistant for IBM workflows. |

Bring your own: any runtime that speaks [ACP](https://agentclientprotocol.com/get-started/introduction) runs on DAM with the full platform feature set, no adapter required.

---

## Built in the open

DAM is developed in the open, and the roadmap is public. The next big push is making agent collaboration first-class: pick a model per subagent, share a workspace between them, race two harnesses on one task from the UI. Follow the work in [the delegation epic](https://github.com/dam-agents/dam/issues/3419).

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
````

Open [localhost:4444](http://localhost:4444) and log in with:

```txt
username: dev
password: dev
```

Create an instance from a template and start chatting with your agent.

See [work process](docs/guidelines/work-process.md) for the contributor workflow.

</details>

---

<p align="center">
  <sub>DAM stands for <strong>Deploy Agents Massively</strong>. (Legal rejected <em>Dangerously Autonomous Machines</em>.)</sub>
</p>
