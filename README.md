<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/dam-light.svg" />
    <source media="(prefers-color-scheme: light)" srcset="docs/assets/dam-dark.svg" />
    <img src="docs/assets/dam-square-dark.svg" width="140" alt="DAM" />
  </picture>
</p>

<p align="center">
  <strong>Run AI agents in the cloud, on a schedule, connected to your tools.</strong>
</p>

<p align="center">
  <a href="https://ibm.biz/dam-docs">Documentation</a> ·
  <a href="https://ibm.biz/dam-agents">Launch DAM</a> ·
  <a href="https://ibm.biz/dam-waitlist">Join the Waitlist</a>
</p>

---

Your agent runs on cloud infrastructure — close your laptop, shut it down, it keeps working. Tokens are injected at the network layer by a separate gateway; the agent process never sees them. Your whole team interacts with shared agents via Slack, each person authenticated individually.

## Why DAM?

- **Always-on compute** — Your agent runs on cloud infrastructure. Close your laptop, shut it down, it keeps working.
- **Zero-trust credentials** — Tokens are injected at the network layer by a separate gateway. The agent process never sees them.
- **Multiplayer** — Your whole team interacts with shared agents via Slack — each person authenticated individually.
- **Unattended execution** — Agents run on a schedule with no human in the loop. Daily PR reviews, nightly audits, whatever you need.

## Modes of Interaction

- **Web UI** — Browser-based chat and a full terminal view — quick tasks, file browsing, or the native agent TUI.
- **CLI** — Create and manage agents from your local terminal, then attach directly to interactive sessions.
- **Slack** — Message your agent from Slack threads. Teammates join with their own credentials.
- **Schedules** — Agents run autonomously on a timer — no human in the loop.

## Available Agent Harnesses

- **Claude Code** — General-purpose coding: write, debug, refactor, review.
- **Pi Agent** — Multi-model coding (GPT-4, Mistral, Gemini, etc.)
- **Bob** — IBM's general-purpose AI shell with tenant scoping.
- **Codex** — OpenAI-powered coding with any compatible endpoint.

Bring your own harness — anything that speaks [ACP](https://agentclientprotocol.com/get-started/introduction) works.

## Get Started

Head to [ibm.biz/dam-agents](https://ibm.biz/dam-agents), create an instance from a template, and start chatting. See the [documentation](https://ibm.biz/dam-docs) for quickstarts, core concepts, integration guides, and use cases.

---

<details>
<summary><strong>Developing DAM locally</strong></summary>

For contributors working on the platform itself.

**Prerequisites:** [mise](https://mise.jdx.dev), a Docker-compatible runtime (Docker Desktop, Rancher Desktop, etc.), macOS or Linux.

```sh
git clone https://github.com/dam-agents/dam && cd dam
mise install                # install toolchain + deps
mise run cluster:install    # create local k3s cluster + deploy DAM
```

Open [localhost:4444](http://localhost:4444) (login: `dev` / `dev`), create an instance from a template, and start chatting.

See [work process](docs/guidelines/work-process.md) for the contributor flow from idea to merged code.

</details>
