# Why DAM

## What's an agent

A service that has an LLM, calls external systems, and exercises autonomy. The key word is autonomy: the agent decides *how* to solve a problem, not just execute pre-determined logic. This is what makes agents different from traditional services, and what makes them hard to govern.

## Three levels of abstraction

There are three levels of abstraction for how developers express agent work today. Each gives up some control in exchange for more AI autonomy:

1. **Code.** You write explicit control flow using frameworks like LangGraph or CrewAI, packaged as containers. You decide what happens at each step. The agent follows your logic.

2. **Harness.** You take a general-purpose tool like Claude Code, Codex, or Gemini CLI, give it a system prompt, file access, and tools. You configure more than you program, though you might still write custom skills or scripts. The harness decides execution details.

3. **Always-on assistant.** You interact through conversation. The assistant programs itself based on your interactions: building software, creating skills on the fly, automating workflows. Under the hood it uses a harness, but the user doesn't interact with the harness directly. The harness is the engine; the assistant is the experience. Think OpenClaw or NanoClaw.

All three hit the same wall when you try to run them in production: no open-source platform makes them safe, manageable, and independent of a single vendor.

## The problem

OpenClaw is wildly successful and keeps getting better. But it's a general-purpose platform that tries to serve every user and every scenario. DAM takes a different angle: narrower focus, zero-trust by default, building blocks instead of opinions.

When an agent has bash access and can manipulate files, security can't be an afterthought. Credentials shouldn't be passed to the model. Network access shouldn't be open by default. Isolation shouldn't be optional. These aren't features. They're the foundation everything else is built on.

And if you want to run agents on your own infrastructure without being tied to a specific vendor's harness, model, or cloud, that option doesn't exist today.

## What DAM does

DAM is a Kubernetes platform focused on running AI harnesses in production. It covers the second category (harnesses) and is building the foundation for the third (always-on personal assistants).

**You bring the harness. DAM makes it production-ready.**

Here's what that means:

- **Your agent runs in an isolated container.** Each invocation gets a fresh pod. Agents can't see each other's files, network, or processes. Workspace files (memory, skills, project artifacts) persist between runs on a volume. The container itself is disposable.

- **Your agent never sees real credentials.** Each pod runs an Envoy credential-gateway sidecar that injects real tokens at the HTTP level from K8s Secrets mounted only into the sidecar — the agent container never has them. If the agent gets compromised, there are no secrets to steal.

- **Scheduling and heartbeat are built in.** The platform owns cron, not the agent. When a schedule fires, the platform writes a trigger file to the agent's workspace. The agent wakes up, processes it, and goes back to sleep. A heartbeat works the same way: wake up, review history, decide if anything needs doing.

- **The harness doesn't know it's managed.** A scheduled task looks the same as a user message. A credential-injected API call looks the same as a normal request. The harness runs the same way locally and in production.

- **No vendor lock-in.** Model-agnostic. Harness-agnostic. Any harness that speaks ACP works. Today that's Claude Code, but the platform is designed for Codex, Gemini CLI, and whatever comes next.

## What DAM believes

- **The harness is the unit of AI development.** The platform's job is to run it safely, not replace it.
- **Security must be structural.** If it depends on the agent behaving correctly, it's not security.
- **Kubernetes is the right foundation.** Isolation, scheduling, persistence, and networking out of the box. ConfigMaps instead of CRDs so you don't need cluster-admin.
- **No opinions on agent internals.** How agents manage memory, prompts, and context is the developer's problem. The platform provides primitives.

## Where this is going

DAM focuses on harnesses today and is preparing the building blocks for always-on personal assistants (scheduling, heartbeat, persistent workspace, channel integrations). A separate experiment will build an enterprise-grade OpenClaw alternative on top of these building blocks: an assistant that uses the harness to build software, create skills, and automate workflows, wrapped in an experience that's safe and manageable for enterprise use.
