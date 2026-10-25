 <p align="center">
  <img src="docs/assets/dam-dark.svg#gh-light-mode-only" alt="DAM" />
  <img src="docs/assets/dam-light.svg#gh-dark-mode-only" alt="DAM" />
</p>

<h3 align="center">
An open platform for long-lived AI agents.

Any harness, any model, on Kubernetes.
</h3>

<p align="center">
  Run agents at scale with isolated sandboxes, credential injection, persistent workspaces, orchestration, scheduled triggers, Slack integration, and cost visibility.
</p>

<p align="center">
  <a href="#get-started"><strong>Get started</strong></a>
  ·
  <a href="#capabilities"><strong>Capabilities</strong></a>
  ·
  <a href="https://github.com/dam-agents/dam/issues"><strong>Contribute</strong></a>
</p>

<p align="center">
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/badge/license-Apache--2.0-blue.svg" /></a>
  <img alt="Kubernetes" src="https://img.shields.io/badge/runs%20on-Kubernetes-326ce5" />
</p>

---

## Get started

<table>
<tr>
<td width="50%" valign="top">

### Open source

Deploy DAM on your own infrastructure and build with the platform.

- [Deployment guide](#run-your-own)
- [Architecture](docs/architecture.md)
- [All repositories, Starter Kits, and examples](https://github.com/orgs/dam-agents/repositories)
- [Issues and contributions](https://github.com/dam-agents/dam/issues)

</td>
<td width="50%" valign="top">

### IBM hosted deployment

Use DAM through IBM Research without managing your own cluster.
Sign in with your IBM login to start.

- [Launch DAM](https://ibm.biz/dam-agents)
- [IBM documentation](https://ibm.biz/dam-docs)

The hosted deployment includes IBM internal model endpoints and integrations not included in the open-source deployment.

</td>
</tr>
</table>

---

## Why DAM?

- **Isolated by design:** Sandboxed agents, credential isolation, network controls, and optional human approval.
- **Always on:** Persistent workspaces preserve files, memory, and context beyond individual sessions.
- **Any harness, any model:** Claude Code, Codex, Pi Agent, Bob, GitHub Copilot, and other ACP-compatible runtimes.
- **Built for teams:** Shared agents accessible through Slack, Telegram, web UI, and CLI.
- **Automate and coordinate:** Scheduled workflows and subagents that can split work across harnesses and models.
- **Understand costs:** Usage, budgets, and activity visibility by user, agent, harness, and model.

## What you can build

- **Software engineering:** Software factories, code reviews, debugging, and cross-harness evaluations.
- **Research:** Side-by-side model and harness experiments with persistent environments and shareable artifacts.
- **Assistants:** Team agents that maintain context, respond to messages, and run on schedules.
- **Team knowledge:** Agents that turn meetings and discussions into durable, linked knowledge.

## Capabilities

| Building block        | What it provides                                                      |
| --------------------- | --------------------------------------------------------------------- |
| Harnesses and models  | Pluggable agent runtimes and inference endpoints                      |
| Security              | Isolation, credential injection, network controls, optional approvals |
| Workspaces and memory | Persistent files and context                                          |
| Orchestration         | Schedules, subagents, and multi-agent workflows                       |
| Channels              | Slack, Telegram, web UI, and CLI                                      |
| Skills and artifacts  | Reusable workflows and shareable results                              |
| Cost visibility       | Usage, budgets, and activity history                                  |

---

## Run your own

DAM is Apache 2.0 licensed and deploys to Kubernetes using Helm.

```sh
helm install platform oci://quay.io/dam-agents/charts/platform
```

The chart includes Keycloak, Postgres, Valkey (a Redis-compatible cache), and optional telemetry.
DAM requires an Istio ambient mesh.

- [Deployment configuration](helm/values.yaml)
- [Architecture](docs/architecture.md)
- [Security and credentials](docs/architecture/security-and-credentials.md)

## Contribute

DAM is developed in the open.
Follow development, report issues, and help shape the project.

- [Open issues](https://github.com/dam-agents/dam/issues)
- [Contribution guidelines](CONTRIBUTING.md)

<details>
<summary><strong>Developing DAM locally</strong></summary>

### Prerequisites

- [mise](https://mise.jdx.dev)
- macOS or Linux

On Linux, install QEMU to run k3s in a VM, or set `IS_SANDBOX=1` when running directly in an existing VM.
Rust builds need the machine's C toolchain, and the VM runner's image build (only with virtualization on) also needs glibc's static library: `build-essential` on Debian and Ubuntu has both.

### Setup

```sh
git clone https://github.com/dam-agents/dam
cd dam
mise install
mise run cluster:install
```

Open [localhost:4444](http://localhost:4444) and log in with `dev` / `dev`.

### The Rust build cache

`cargo` in this repository runs through [mr boxington](https://mr-boxington.jdx.dev/), which keeps compiled crates in a content-addressed store and restores what another checkout or worktree already built.
A second checkout builds the VM runner in about half the time, and CI shares the same cache through GitHub Actions.
The tool and the `cargo` wrapper are declared in [`.mise/config.toml`](.mise/config.toml), so they are active in this repository alone and nothing changes in your global mise or editor configuration.

The store collects as it fills, up to 60 GiB.
Set a different budget with `MBX_GC_MAX_TOTAL_SIZE` in a `mise.local.toml`, run one command without the cache with `MBX_DISABLE=1 cargo …`, and read what the cache saved with `mbx stats`.
The VM runner's own target directory becomes a symlink into the store, which [`prune-target`](packages/vm-runner/.mise/prune-target) tolerates: it removes the link, and the next build makes it again.

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for contribution instructions and [`AGENTS.md`](AGENTS.md) for engineering conventions.

</details>
