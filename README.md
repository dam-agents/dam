<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/dam-logo-custom.png" />
    <source media="(prefers-color-scheme: light)" srcset="docs/assets/dam-logo-custom.png" />
    <img src="docs/assets/dam-logo-custom.png" width="100%" alt="DAM" />
  </picture>
</p>

<h3 align="center">
The platform for AI-powered research.
</h3>

<p align="center">
  <a href="https://ibm.biz/dam-docs"><strong>Documentation</strong></a>
  ·
  <a href="https://ibm.biz/dam-agents"><strong>Launch DAM</strong></a>
  ·
  <a href="https://ibm.biz/dam-waitlist"><strong>Join the Waitlist</strong></a>
  ·
  <a href="https://pages.github.ibm.com/dam-agents/docs/getting-started/quickstart/"><strong>Quick Start</strong></a>
</p>

---

## DAM combines research tools with AI infrastructure to enable quicker, more impactful results. 

IBM's teams have proven the efficacy of implementing AI tools for research, from building ["agent factories" for hardware optimization](https://arxiv.org/abs/2603.25719) to developing [evolutionary frameworks to find quantum error correction codes](https://research.ibm.com/blog/ai-for-qec). **DAM packages all the tools research teams need to access those benefits in minutes, avoiding the lift of building bespoke tooling**.

- **🔬 Evolve code.** Experiments are scaffolded nativley from a library of re-usable templates, patterns and techniques proven to deliver results.

- **☁️ Runs in the cloud.** Loops execute continuously, executing even when you're away. From self-updating documentation to 

- **🔐 Secure sandboxes.** Each agent runs in an isolated container with all access routed through a policy-enforced gateway. Agents connect to tools without exposing credentials to the runtime.

- **👥 Built for teams.** Collaborate in Slack and run agents on schedules for recurring workflows.

- **🧠 Knowledgeable decisions.** Memory sources such as LLM Wikis on-the-fly MCP servers ensure agents start smart and experiments can capture and learn from their findings.

- **⏱️ Scheduled workflows.** Outside loops, agents can run on a recurring timer for tasks such as daily code reviews, nightly audits, codebase health monitoring.

- **🔧 Constantly growing.** DAM is continusily growing alongside our researchers. If there's a feature, framework, or workflow you'd like to see included in DAM, [let us know]().



### Where DAM runs

| Mode | Description |
|---|---|
| **Web UI** | Chat with your agent, stream its terminal, and manage files — all from the browser. |
| **CLI** | Create agents, attach to live sessions, and manage instances from your local terminal. |
| **Slack** | Message your agent from Slack threads. Teammates interact with their own credentials. |
| **Schedules** | Run agents on a recurring timer — daily code reviews, nightly audits, continuous monitoring. |
---

<details>
<summary><strong>Developing DAM locally</strong></summary>

**For contributors working on the DAM platform itself.**

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
