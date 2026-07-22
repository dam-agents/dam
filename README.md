<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/dam-logo-custom.png" />
    <source media="(prefers-color-scheme: light)" srcset="docs/assets/dam-logo-custom.png" />
    <img src="docs/assets/dam-logo-custom.png" width="100%" alt="DAM" />
  </picture>
</p>

<h3 align="center">
The platform for AI-powered research.   <a href="https://ibm.biz/dam-agents"><strong>Launch DAM</strong></a>.
</h3>

<p align="center">
  <a href="https://ibm.biz/dam-docs"><strong>Documentation</strong></a>
  ·
  <a href="https://ibm.biz/dam-agents"><strong>Launch DAM</strong></a>
  ·
  <a href="https://ibm.biz/dam-waitlist"><strong>Join the Waitlist</strong></a>
  ·
  <a href="https://pages.github.ibm.com/dam-agents/docs/getting-started/quickstart/"><strong>Quick Start</strong></a> ·
  <a href="https://ibm.biz/dam-docs"><strong>Slack</strong></a>
</p>

---

## DAM combines research tools with AI infrastructure to enable quicker, more impactful results. 

IBM's teams have proven the efficacy of implementing AI tools for research, from building ["agent factories" for hardware optimization](https://arxiv.org/abs/2603.25719) to developing [evolutionary frameworks to find quantum error correction codes](https://research.ibm.com/blog/ai-for-qec). **DAM packages all the tools research teams need to access those benefits in minutes, avoiding the lift of building bespoke tooling**.

- **🔬 Evolve code.** Experiments are scaffolded nativley from a library of re-usable loop templates, patterns and techniques proven to deliver results. 

- **☁️ Runs in the cloud.** Workloads execute continuously, executing even when you're away, accesiable via a Web UI, CLI, or Slack integration.

- **🔐 Secure sandboxes.** Each agent runs in an isolated container with all access routed through a policy-enforced gateway. Agents connect to tools without exposing credentials to the runtime.

- **👥 Built for teams.** Collaborate in Slack, share artifacts, and contribute to shared findings.

- **🧠 Knowledgeable decisions.** Memory sources such as LLM Wikis on-the-fly MCP servers ensure agents start smart and experiments can capture and learn from their findings.

- **⏱️ Scheduled workflows.** Outside loops, agents can run on a recurring timer for tasks such as daily code reviews, nightly audits, codebase health monitoring.

- **🔧 Constantly growing.** DAM is continusily growing alongside our researchers. If there's a feature, framework, or workflow you'd like to see included in DAM, [let us know]().

## Architecture
```mermaid
%%{init: {"theme": "base", "themeVariables": {"primaryColor": "#1a1a1a", "primaryTextColor": "#ffffff", "primaryBorderColor": "#444444", "lineColor": "#686EFF", "secondaryColor": "#111111", "tertiaryColor": "#0d0d0d", "clusterBkg": "#111111", "clusterBorder": "#444444", "titleColor": "#ffffff", "edgeLabelBackground": "#1a1a1a", "fontFamily": "monospace"}}}%%
flowchart LR
  user[browser user]
  slack-user[Slack user]
  cli[dam CLI]
  llm[LLM APIs]
  github[GitHub]

  subgraph cluster[Platform install]
    ui[ui]
    api-server[api-server]
    controller[controller]
    keycloak[keycloak]
    postgres[(postgres)]
    redis[(redis)]
    k8s-api[(K8s API)]
    subgraph agentpod[agent pod]
      agent-runtime
    end
    subgraph gatewaypod[gateway pod]
      envoy[Envoy]
    end
  end

  user -->|HTTP + WS| ui
  ui -->|tRPC + ACP/WS| api-server
  user -->|OIDC| keycloak

  slack-user <-->|Slack API| api-server

  cli -->|tRPC + WS| api-server

  api-server <-->|ACP relay / tRPC proxy| agent-runtime
  api-server -->|REST| k8s-api
  api-server -->|JWKS validate| keycloak
  api-server -->|metadata| postgres
  api-server -->|BullMQ jobs / pub-sub| redis

  controller -->|watch + status| k8s-api

  agent-runtime -->|HTTPS_PROXY| envoy
  envoy -->|ext_authz Check| api-server
  envoy -->|inject credentials| llm
  envoy -->|inject credentials| github

  classDef external fill:#1a1a1a,stroke:#686EFF,color:#ffffff
  classDef frontend fill:#2876FF,stroke:#2876FF,color:#ffffff
  classDef backend fill:#7C26FF,stroke:#7C26FF,color:#ffffff
  classDef infra fill:#333333,stroke:#888888,color:#ffffff
  classDef gateway fill:#FF57A0,stroke:#FF57A0,color:#ffffff
  classDef agent fill:#686EFF,stroke:#686EFF,color:#ffffff

  class user,slack-user,cli,llm,github external
  class ui frontend
  class api-server,controller,keycloak backend
  class postgres,redis,k8s-api infra
  class envoy gateway
  class agent-runtime agent
```
## Contribute

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
