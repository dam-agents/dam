# OpenShell credential isolation vs. Platform pod-pair model — threat model

Last verified: 2026-05-13

A code-cited comparison of where real credentials live in NVIDIA OpenShell vs. our paired-pod design, and what an agent running untrusted code can actually do to reach them under each model. Written to address a specific claim heard in the wild: that **OpenShell injects credentials at the gateway** and/or that **the agent ends up with the real bearer token in its environment**. Both readings are wrong on the code; the more interesting question is what each model is actually robust against.

The OpenShell sources cited are from a local clone at [`context/OpenShell/`](../../context/OpenShell/) and were read directly, not summarised from upstream docs.

## TL;DR

- In OpenShell, real credentials live in **the supervisor process's heap** inside the sandbox workload — same kernel, same container/VM, same `/proc`, parent of the agent. The agent's environment receives **placeholder strings**, never the real token, including for non-inference providers like GitHub. The README's "credentials never leak into the sandbox filesystem; they are injected as environment variables at runtime" is technically true and badly worded — the env-var value is a placeholder, not the credential.
- In Platform, real credentials live in **the gateway pod**, mounted from K8s Secrets as SDS files into Envoy. The agent pod is a separate pod with no Secret mount, no SA token, no shared PID/IPC/filesystem namespace with the gateway, and is gated to a single egress destination by per-pair NetworkPolicy.
- For ordinary agent misbehaviour (prompt-injected ordinary code, no privilege primitives), **both models hold equivalently**.
- For an adversary with **any in-sandbox privilege-escalation or container-escape primitive**, OpenShell's credential boundary degrades to the same kernel/VM the adversary already controls. Platform's boundary remains a separate pod (with Kata: a separate VM). The same class of exploit that exfiltrates credentials in OpenShell is structurally non-reachable in Platform without a second-stage cross-VM motion.
- The Envoy/proxy parser-RCE attack is **equivalent in both models in outcome scope** (one owner's credentials, this instance). It is the only attack where Kata does not help Platform meaningfully more than OpenShell.

## Where the credentials physically live

### OpenShell

1. The gateway stores provider credentials (real values) in SQLite or Postgres.
2. The sandbox supervisor fetches them via gRPC at startup ([`provider.rs:608-644`](../../context/OpenShell/crates/openshell-server/src/grpc/policy.rs#L608-L644), `GetSandboxProviderEnvironment`).
3. The supervisor immediately wraps them into a `SecretResolver` whose private `by_placeholder: HashMap<String, String>` holds the real values ([`secrets.rs:153-165`](../../context/OpenShell/crates/openshell-sandbox/src/secrets.rs#L153-L165)):

   ```rust
   for (key, value) in provider_env {
       let placeholder = placeholder_for_env_key_for_revision(&key, revision);
       child_env.insert(key.clone(), placeholder.clone());      // ← what the agent sees
       by_placeholder.insert(placeholder, value.clone());        // ← real value, supervisor heap only
   }
   ```

4. The agent process is spawned with `child_env` — placeholders only ([`process.rs:27-30`](../../context/OpenShell/crates/openshell-sandbox/src/process.rs#L27-L30), [`process.rs:822-840`](../../context/OpenShell/crates/openshell-sandbox/src/process.rs#L822-L840) test asserts this for `ANTHROPIC_API_KEY`).
5. The proxy (same process as the supervisor) consults the resolver and rewrites `Bearer openshell:resolve:env:KEY` to the real token on outbound HTTPS requests ([`secrets.rs:205-245`](../../context/OpenShell/crates/openshell-sandbox/src/secrets.rs#L205-L245)).

This is uniform across **all** providers. The gateway-side resolver at [`provider.rs:261-292`](../../context/OpenShell/crates/openshell-server/src/grpc/provider.rs#L261-L292) is category-blind — no inference-vs-non-inference branching. The dispositive test using `GITHUB_TOKEN` specifically is [`provider_credentials.rs:113-150`](../../context/OpenShell/crates/openshell-sandbox/src/provider_credentials.rs#L113-L150).

**Locality.** The credentials are in the supervisor process. The supervisor is PID 1 in the sandbox container/VM. The agent is its child. They share the kernel, share the `/proc` view, share the filesystem (with Landlock restrictions), share the network namespace (or share its parent), and depending on the driver may share PID namespace.

### Platform

1. The api-server writes K8s Secrets keyed `(owner, connection)`, labelled `platform.ai/owner=<sub>` ([`security-and-credentials.md:149-164`](../architecture/security-and-credentials.md#L149-L164)).
2. The controller renders **two pods** per agent instance: an agent pod and a paired gateway pod. The K8s Secret is mounted **only into the gateway pod**, as the SDS YAML Envoy reads via `path_config_source`.
3. The agent pod has `automountServiceAccountToken: false`, no Secret mount, no env var with the credential, no path to the K8s API.
4. The agent reaches the gateway only by `HTTPS_PROXY=<instance>-gateway:<envoyPort>`. Envoy on the gateway pod MITMs the agent's TLS using a per-instance leaf cert; the agent's CA bundle is a single-key projection of `ca.crt`, with `tls.key` staying in the gateway pod.
5. Envoy injects the credential header per-route, matching on resolved upstream cluster + SNI (not the agent's `Host:` header) — see [ADR-033 §Credential injection](../adrs/033-envoy-credential-gateway.md#L38-L57) and [ADR-033 §Threat Model: route confusion](../adrs/033-envoy-credential-gateway.md#L110-L114).

**Locality.** Credentials are in the gateway pod's Envoy heap and as files inside the gateway pod's filesystem. The agent pod's process tree, `/proc`, filesystem, and network namespace contain nothing about them.

## Side by side

| Property | OpenShell | Platform |
|---|---|---|
| Real credential location | Supervisor process heap | Gateway pod (Envoy heap + mounted Secret file) |
| Sandbox unit | 1 container or 1 microVM (libkrun driver) | 2 pods per instance (agent + gateway); each pod is 1 microVM under Kata |
| Agent kernel | Shared with supervisor | Separate from gateway under Kata; separate cgroup/PID/net/mount namespaces always |
| Agent's admitted IPC reach to credential holder | Multiple loopback ports + Unix sockets (proxy CONNECT, supervisor SSH, file sync, log push, relay) | One TCP destination (gateway Service on Envoy port), gated by per-pair NetworkPolicy |
| K8s SA token in agent | Whatever chart provisions (in K8s driver) | `automountServiceAccountToken: false` — no token, no API reach |
| Per-instance crypto identity | Gateway mTLS to control plane | Per-instance/per-fork SPIFFE SA principal + Istio AuthorizationPolicy on harness waypoint + ext-authz Service |
| Destination-vs-credential pinning | Provider YAML declares `endpoints`; enforcement path needs verification (see §Open verifications) | Cryptographically pinned via SNI-bound STRICT_DNS clusters per credential (ADR-033) |

## Threat-by-threat

### T1. Reading the credential out of `/proc/<supervisor>/mem`

The agent attaches to the supervisor process and reads heap.

**OpenShell.** Same PID namespace by default. Agent sees the supervisor's PID. `/proc/<pid>/mem` is mode-0 to the agent under default Linux DAC + `kernel.yama.ptrace_scope=1`, and seccomp can block `ptrace`. **Closed in the happy path**, but the conditions are operational: distinct uid (✓), ptrace_scope ≥ 1, seccomp profile actually blocks ptrace, supervisor doesn't drop privileges or leak setuid binaries. One DAC bypass, one in-kernel privilege-escalation primitive (dirty-pipe class, overlay races, eBPF verifier bugs), one supervisor-uid confusion, and the heap is readable. **The credential never moved further than a same-host kernel away.**

**Platform.** No PID namespace overlap with the gateway pod. There is no `/proc/<gateway-pid>` reachable from inside the agent pod — they are different pods with different sandboxes. Under Kata they are **different VMs sharing no kernel**. Attack requires (a) container escape from the agent pod, then (b) lateral pivot to the gateway pod (a second sandbox). With Kata, (a) is a hypervisor escape, not a host-kernel CVE.

### T2. Ptrace, gdb-style debugging

Variant of T1 — direct debugging of the parent process.

**OpenShell.** Mitigated by same conditions as T1. Crucially, the supervisor is the agent's **parent**, so `prctl(PR_SET_DUMPABLE, 0)` doesn't help on its own; the boundary really is uid + seccomp + ptrace_scope.

**Platform.** Not applicable — no parent-child relationship, no shared PID namespace.

### T3. Supervisor-exposed IPC parser bugs

The supervisor exposes attack surfaces to the agent by design.

**OpenShell.** Per [`sandbox.md:79-81`](../../context/OpenShell/architecture/sandbox.md#L79-L81): *"The supervisor runs an SSH server on a Unix socket inside the sandbox."* Plus the proxy CONNECT listener on a loopback port, plus log push, plus file sync, plus relay sockets. **The agent has L4 reach to every supervisor-exposed endpoint by design.** A parsing bug in any one of them is RCE in the credential-holding process. Mitigation is code quality + Rust memory safety; structurally the surface is large.

**Platform.** The agent's admitted intra-cluster destinations are exactly two: cluster DNS (`kube-system` UDP/TCP 53 or `openshift-dns` UDP/TCP 5353), and the paired gateway's Envoy proxy port ([`network_policy.go:85-133`](../../packages/controller/pkg/reconciler/network_policy.go#L85-L133)). No SSH, no relay, no file sync, no IPC to the gateway. Everything else (SDS, harness origination, ext-authz origination) is gateway-initiated outbound; the agent cannot reach those code paths from its side.

### T4. Proxy data-plane parser RCE

HTTP/2, h2c, TLS, header parsing. The big remote-shaped attack.

**OpenShell.** RCE inside the supervisor process → **all this sandbox's credentials immediately**. The proxy and the resolver share `by_placeholder` in the same address space.

**Platform.** RCE inside the gateway pod's Envoy → **all this instance's credentials immediately** (SDS-loaded). Same scope, different pod.

**Net.** Equivalent in outcome scope. Different in collateral: OpenShell's RCE also gives the attacker the agent process (it's a child) and the sandbox's filesystem; Platform's RCE inside the gateway pod gives nothing inside the agent pod. **This is the only major threat where Kata does not help Platform meaningfully more than OpenShell** — same Envoy code is the parser surface in both.

### T5. Container escape from agent → host kernel

A host-kernel CVE exploited from inside the agent's container.

**OpenShell, Docker/Podman driver.** Shared host kernel. Once on the host, the supervisor process is a sibling on the same kernel, plus the gateway daemon, plus the SQLite/Postgres credential store on the host. Game over.

**OpenShell, libkrun (microVM) driver.** Hardware-virtualized kernel — meaningful uplift against host escape. **But the supervisor, the proxy, and the credentials are inside the same microVM as the agent.** An in-VM kernel exploit (the same dirty-pipe-class bugs, just inside the sandbox's own kernel) is still inside the credential-holding process's address space. Hardware virtualization helps for "agent ↔ host," does nothing for "agent ↔ supervisor in the same VM."

**Platform, runc.** Same host-kernel risk as OpenShell Docker driver. Difference: after escape, the gateway pod is **a different pod**. Reaching it requires getting onto the gateway pod's network namespace or filesystem. On OpenShift, the agent pod is locked to UID 65532 under the `nonroot-v2` SCC (see [`feat/openshift-nonroot-scc`](../../deploy/helm/platform/templates/) and recent commit history), with no privileged caps. Not in-itself enough to stop a kernel CVE.

**Platform, Kata.** This is the structural delta. The agent's pod is **its own VM**. Container escape lands the attacker inside the agent's lightweight VM, which contains **no credentials and no credential-holding processes**. The gateway pod is a **separate VM**. Crossing requires a hypervisor escape (firecracker / cloud-hypervisor / QEMU exploitation) followed by lateral motion to the gateway VM (which is also Kata-isolated). **Two hardware-virtualized boundaries** the adversary now has to traverse, with two separate cross-VM exploit chains.

### T6. Credential cross-injection (wrong-host placeholder resolution)

The sandbox has two providers attached (e.g., GitHub + Anthropic). Agent puts the wrong provider's placeholder in a header to an attacker-influenced allowed destination.

**OpenShell.** [`secrets.rs:184-203`](../../context/OpenShell/crates/openshell-sandbox/src/secrets.rs#L184-L203) (`resolve_placeholder`) is destination-blind — it looks up the placeholder in the resolver with no awareness of the request's destination. Whether the L7 enforcement layer in `proxy.rs` validates destination-vs-credential before calling `rewrite_header_value` needs verification (see §Open verifications). Provider YAMLs declare `endpoints`, so the policy data exists — but the resolver itself does not enforce.

**Platform.** Closed structurally. ADR-033 calls this *"route-confusion exfiltration"* and binds credentialed routes to resolved upstream cluster + SNI, not to the agent's inner `Host:` header ([`033-envoy-credential-gateway.md §Threat Model`](../adrs/033-envoy-credential-gateway.md#L110-L114)). The agent's choice of which placeholder to use doesn't influence destination — each credential has its own STRICT_DNS cluster pinned to its host with SAN-bound TLS validation.

### T7. K8s API / SA-token enumeration

**OpenShell on K8s driver.** Sandbox pod is a generic pod with whatever ServiceAccount the chart configures. If that SA has any `get secrets` reach to the namespace where credentials are kept, an agent that reads its own SA token reads the credentials directly. Mitigation is purely chart configuration discipline.

**Platform.** `automountServiceAccountToken: false` on the agent pod ([ADR-033 §Threat Model](../adrs/033-envoy-credential-gateway.md#L114-L117)). No SA token at all on the agent, no K8s API reach from the agent. Structurally closed.

### T8. Sandbox-to-sandbox / instance-to-instance lateral motion

**OpenShell.** All sandboxes share one gateway and one credential store. Lateral motion requires reaching the gateway. The gateway exposes mTLS-protected gRPC; supervisors open outbound sessions, so the gateway doesn't dial sandbox ports inbound. Reasonable boundary, but a compromised supervisor speaks mTLS to the gateway with its own credentials and could in principle request another sandbox's provider environment if authorization isn't per-sandbox-scoped at the gateway. Needs verification.

**Platform.** Two cryptographic boundaries:
- **Agent layer.** Per-pair NetworkPolicy pins each agent to its paired gateway only. Pod-selector at [`network_policy.go:121-128`](../../packages/controller/pkg/reconciler/network_policy.go#L121-L128) targets the **specific gateway pod for this pair**; agent A cannot speak to gateway B's Envoy port at all.
- **Gateway layer.** Istio AuthorizationPolicy on the api-server harness waypoint requires the per-instance SPIFFE principal. Gateway pod A cannot impersonate instance B even if compromised. Fork pairs get their own per-fork SA distinct from the parent's, so a compromised fork cannot impersonate the parent on the harness path ([`security-and-credentials.md:265-285`](../architecture/security-and-credentials.md#L265-L285)).

### T9. DNS exfiltration

Both architectures admit DNS for the resolver, and CoreDNS (or equivalent) forwards non-cluster queries upstream by default. An agent can encode payloads in DNS labels and exfil over UDP/53 without ever touching the proxy.

**OpenShell.** Depends on the driver's network setup — whether DNS goes through the sandbox proxy or hits the host stack directly. The doc on [`sandbox.md:41`](../../context/OpenShell/architecture/sandbox.md#L41) says *"Network namespace forces ordinary agent egress through the local CONNECT proxy"* — but DNS is not HTTP and is typically resolved via the namespace's `/etc/resolv.conf`, which points at a resolver outside the proxy. Same gap class as Platform's.

**Platform.** Acknowledged residual. [ADR-042 §Consequences](../adrs/042-agent-egress-network-policy.md#L111-L116) states explicitly: *"DNS tunneling via CoreDNS's upstream forwarder remains a residual, low-bandwidth exfil channel… Closing this requires per-pod DNS policy or a DNS-aware egress filter, neither in scope here."*

**Net.** Equivalent gap in both, of the same shape. Neither model closes it without a constrained recursive resolver.

### T10. Core dumps and swap

**OpenShell.** Credentials in supervisor heap. If `core_pattern` is permissive or swap is enabled and includes the supervisor's pages, real values can hit disk. Default container configs usually disable coredumps; not guaranteed across all drivers and host configurations.

**Platform.** Credentials in Envoy heap in the gateway pod. Same swap/coredump concern, but **scoped to the gateway pod's resource limits and runtime**. The agent pod cannot influence the gateway pod's coredump policy.

## The Kata Containers question, explicitly

The question worth being precise about: **does Kata Containers make OpenShell as secure as Platform?**

Short answer: **No, because Kata isolates a *workload*, and OpenShell's workload contains both the agent and the credentials.**

Long answer:

- Kata-style runtime works by giving each pod its own lightweight VM with its own kernel, isolated from the host kernel and from other pods' VMs. The benefit is that container escape from inside the pod stops at the VM kernel, not the host kernel — the attacker now needs a hypervisor escape (a much rarer class of bug) to reach the host or other pods.

- OpenShell's libkrun driver (`openshell-driver-vm`) is the OpenShell-side equivalent of Kata: each sandbox gets its own microVM. **This is a real and meaningful uplift for OpenShell over the Docker driver** for host-escape protection (T5). But: the sandbox VM still contains supervisor + proxy + agent + credentials. An adversary who exploits an in-VM kernel CVE is inside the credential-holding process's address space without crossing any hardware boundary. **The credentials and the agent are in the same VM by design.**

- Platform's Kata story is structurally different: the agent pod and the gateway pod are **two separate pods**, which under Kata means **two separate VMs**. The agent's VM contains no credentials, no credential-holding processes, no key material. The gateway's VM contains all that, but the agent's only admitted L4 reach into it is the Envoy CONNECT proxy port, gated by NetworkPolicy. An adversary with full kernel control inside the agent VM gains the agent's filesystem and that's it — to reach credentials they need a hypervisor escape *and* a lateral motion to the gateway pod (whose VM is also Kata-isolated, plus its inbound TCP surface is just Envoy listening on the proxy port).

So the apples-to-apples table:

| Adversary capability | OpenShell (libkrun) | Platform (Kata) |
|---|---|---|
| Container/VM escape to host | Hardware boundary, hard | Hardware boundary, hard |
| In-sandbox kernel escalation | Inside the credential-holding VM; reads heap | Inside the agent VM; no credentials present |
| Reach credential-holding process from agent | Local IPC, parent process | Different pod, different VM, no admitted IPC except Envoy CONNECT |
| Cross-tenant motion | Requires gateway-mTLS-shaped exploit | Requires hypervisor escape + lateral pivot + SPIFFE-gated AuthZ bypass |

**Kata's benefit to OpenShell is purely the host-escape vector.** It does not change the in-sandbox attack surface against the supervisor. **Kata's benefit to Platform is the agent-pod boundary itself** — and that benefit compounds with NetworkPolicy, Istio mesh on the gateway side, OpenShift SCC pinning the agent UID, and SPIFFE-keyed AuthZ at the destination side.

## Where OpenShell is genuinely good

This memo is not a "OpenShell is insecure" memo. The points worth crediting:

- **The placeholder grammar is sound.** Agents really do not see the real bearer token. The README is misleading; the code is fine.
- **The model is uniform.** GitHub, Anthropic, GitLab, Copilot — same path, same isolation properties, no special-casing of inference (the inference-rerouting layer is *additional*, not the only credential-hiding mechanism).
- **The provider YAML schema is clean.** Declarative `endpoints` with method/path enforcement is a sensible policy surface ([`github.yaml:15-25`](../../context/OpenShell/providers/github.yaml#L15-L25)).
- **Per-binary identity (TOFU + binary fingerprinting in the proxy).** Mentioned in [`sandbox.md:42-51`](../../context/OpenShell/architecture/sandbox.md#L42-L51). Platform's Envoy doesn't gate by which agent-side binary made the request — only by route. This is a real OpenShell capability we don't have.

The disagreement is not about whether OpenShell's design is reasonable. It is about whether **process-level isolation inside one workload** vs. **pod-level isolation across two workloads (with optional VM isolation per pod)** are equivalent. They are not. Each additional kernel/VM/network boundary degrades a different class of exploit, and Platform's design layers boundaries that OpenShell's design fuses into a single process address space.

## Open verifications

Two things to verify in OpenShell before publishing this externally, both flagged inline above:

1. **Destination-vs-credential pinning in the proxy.** Whether `proxy.rs` validates that the destination of an outbound request matches the declared endpoints of the provider whose placeholder is being resolved. If not, the wrong-host injection (T6) is a real attack and a CVE-shaped issue worth filing.
2. **DNS posture per driver.** Whether the sandbox's `/etc/resolv.conf` points at a resolver that the OpenShell proxy mediates, or at the host's resolver via the namespace's veth. If the latter, T9 has the same exfil shape as Platform's residual gap.

## What to say when someone claims "OpenShell does credential injection on the gateway"

> No. The gateway stores credentials and serves them over mTLS-protected gRPC to sandbox supervisors. The injection itself happens **inside each sandbox**, in the supervisor process. The README's component table even says so: *"Sandbox: Isolated runtime with container supervision and policy-enforced egress routing."* See [`architecture/gateway.md:19-21`](../../context/OpenShell/architecture/gateway.md#L19-L21) — *"The gateway does not enforce agent network policy at request time. That happens inside each sandbox."*

## What to say when someone claims "the OpenShell agent ends up with the real bearer token in its environment"

> No. The agent's environment contains placeholder strings of the form `openshell:resolve:env:vN_KEY` for every provider credential, including `GITHUB_TOKEN`. The real values stay in the supervisor process's heap and are substituted into outbound HTTP requests by the sandbox proxy at egress. See [`secrets.rs:153-163`](../../context/OpenShell/crates/openshell-sandbox/src/secrets.rs#L153-L163) for the placeholderisation, [`process.rs:822-840`](../../context/OpenShell/crates/openshell-sandbox/src/process.rs#L822-L840) for the test asserting it on the spawned child, and [`provider_credentials.rs:113-150`](../../context/OpenShell/crates/openshell-sandbox/src/provider_credentials.rs#L113-L150) for the dispositive `GITHUB_TOKEN`-specific test.

## What to say when someone claims "Kata makes OpenShell as secure as Platform"

> Kata isolates a workload. In OpenShell, the workload contains both the agent and the credentials, so Kata only protects against host escape — it does not change the in-VM attack surface against the supervisor process. In Platform, the agent and the credentials live in two different pods, which under Kata means two different VMs. Kata's hardware boundary in Platform separates the agent from the credentials; in OpenShell it does not. The two architectures use Kata for structurally different purposes.
