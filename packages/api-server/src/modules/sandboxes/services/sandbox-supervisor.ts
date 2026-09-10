import { mkdir, writeFile } from "node:fs/promises";
import type {
  AgentRecord,
  AgentStatus,
  AgentStore,
} from "../../agents/infrastructure/agent-store.js";
import {
  allocateIndex,
  indexOfAddress,
  linkFor,
  type SandboxLink,
} from "../domain/network.js";
import { layoutFor, socketsFor } from "../domain/layout.js";
import { effectiveIdleTimeoutMs, shouldRun } from "../domain/hibernation.js";
import type { NetworkPort } from "../infrastructure/network-port.js";
import type { ContainerdPort } from "../infrastructure/containerd-port.js";
import type { GatewayPort } from "../infrastructure/gateway-port.js";
import type { PkiPort } from "../infrastructure/pki-port.js";
import type { EnvoyConfigPort } from "../infrastructure/envoy-config-port.js";

export interface SandboxSupervisorDeps {
  store: AgentStore;
  network: NetworkPort;
  containerd: ContainerdPort;
  gateway: GatewayPort;
  pki: PkiPort;
  envoyConfig: EnvoyConfigPort;
  /** Opens the per-agent harness and ext_authz sockets; closes them on delete. */
  sockets: {
    open(agentId: string): Promise<void>;
    close(agentId: string): Promise<void>;
  };
  agentsRoot: string;
  runRoot: string;
  gatewayPort: number;
  sandboxPort: number;
  defaultIdleTimeoutMs: number;
  log: (message: string, fields?: Record<string, unknown>) => void;
}

export interface SandboxSupervisor {
  /** Reconciles one agent to its spec. Safe to call concurrently per agent. */
  reconcile(agentId: string): Promise<void>;
  /** Reconciles every agent, and tears down anything left over. */
  sweep(): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
}

/**
 * The reconcile loop: the agent record is intent, the node is observed state,
 * and this is the only thing that writes `status`.
 *
 * It is change-driven off the store's emitter, with a periodic sweep behind
 * it — the same shape the Kubernetes controller had, for the same reason:
 * an event that is missed or an action that fails must be retried by
 * something that does not depend on the event.
 */
export function createSandboxSupervisor(
  deps: SandboxSupervisorDeps,
): SandboxSupervisor {
  const inflight = new Map<string, Promise<void>>();
  const queued = new Set<string>();
  let unsubscribe: (() => void) | null = null;
  let stopped = false;

  /** Serializes per agent: two reconciles of one agent would race on its netns. */
  function schedule(agentId: string): Promise<void> {
    const current = inflight.get(agentId);
    if (current) {
      queued.add(agentId);
      return current;
    }
    const work = reconcileOne(agentId)
      .catch((err: unknown) => {
        deps.log("sandbox.reconcile.failed", {
          agentId,
          error: err instanceof Error ? err.message : String(err),
        });
        return publishStatus(agentId, {
          ready: false,
          error: err instanceof Error ? err.message : String(err),
          errorReason: "ReconcileError",
        });
      })
      .finally(() => {
        inflight.delete(agentId);
        if (queued.delete(agentId) && !stopped) void schedule(agentId);
      });
    inflight.set(agentId, work);
    return work;
  }

  async function publishStatus(
    agentId: string,
    patch: AgentStatus,
  ): Promise<void> {
    await deps.store.writeStatus(agentId, patch);
  }

  async function linkForRecord(record: AgentRecord): Promise<SandboxLink> {
    const existing = record.status.address
      ? indexOfAddress(record.status.address)
      : null;
    if (existing !== null) return linkFor(record.id, existing);
    const taken = (await deps.store.list()).flatMap((r) => {
      const index = r.status.address ? indexOfAddress(r.status.address) : null;
      return index === null || r.id === record.id ? [] : [index];
    });
    return linkFor(record.id, allocateIndex(taken));
  }

  async function reconcileOne(agentId: string): Promise<void> {
    const record = await deps.store.get(agentId);
    if (!record) return teardown(agentId);

    const idleTimeoutMs = effectiveIdleTimeoutMs(
      record.spec.hibernationTimeout,
      deps.defaultIdleTimeoutMs,
    );
    if (!shouldRun(record.annotations, idleTimeoutMs, new Date())) {
      return hibernate(record);
    }

    const link = await linkForRecord(record);
    const layout = layoutFor(deps.agentsRoot, record.id);
    const sockets = socketsFor(deps.runRoot, record.id);

    for (const dir of [layout.work, layout.home, layout.scratch]) {
      await mkdir(dir, { recursive: true, mode: 0o750 });
    }
    const caCert = await deps.pki.ensureCa();
    await mkdir(layout.root + "/ca", { recursive: true, mode: 0o755 });
    await writeFile(layout.caCert, caCert, { mode: 0o644 });

    await deps.sockets.open(record.id);
    await deps.network.create(link);
    await applyRuleset();

    const { config, hosts } = await deps.envoyConfig.render({
      record,
      link,
      layout,
      sockets,
    });
    await deps.pki.ensureLeaf(layout.leafTls, hosts);
    await deps.gateway.ensureRunning(record.id, layout.gatewayConfig, config);

    await deps.containerd.ensureRunning({
      agentId: record.id,
      image: record.spec.image,
      ...(record.spec.imagePullPolicy
        ? { pullPolicy: record.spec.imagePullPolicy }
        : {}),
      ...(record.spec.registryAuthPath
        ? { registryAuthPath: record.spec.registryAuthPath }
        : {}),
      netns: link.netns,
      env: sandboxEnv(record, link, layout.caCert),
      mounts: [
        { source: layout.work, target: `${homeOf(record)}/work` },
        { source: layout.home, target: homeOf(record) },
        { source: layout.caCert, target: "/etc/platform/ca/ca.crt", readOnly: true },
      ],
      ...(record.spec.resources?.limits
        ? {
            limits: {
              ...(record.spec.resources.limits.cpu
                ? { cpu: record.spec.resources.limits.cpu }
                : {}),
              ...(record.spec.resources.limits.memory
                ? { memory: record.spec.resources.limits.memory }
                : {}),
            },
          }
        : {}),
      labels: { "dam.agent-id": record.id, "dam.owner": record.owner },
    });

    const state = await deps.containerd.inspect(record.id);
    const sandboxReady = state?.running === true;
    const gatewayReady = deps.gateway.isRunning(record.id);
    await publishStatus(record.id, {
      ready: sandboxReady && gatewayReady,
      hibernated: false,
      address: link.sandboxAddress,
      sandboxReady,
      ...(sandboxReady ? {} : { sandboxNotReadyReason: state?.reason ?? "SandboxNotReady" }),
      ...(state?.reason ? { sandboxTerminationReason: state.reason } : {}),
      sandboxRestarts: state?.restarts ?? 0,
      gatewayReady,
      ...(gatewayReady ? {} : { gatewayNotReadyReason: "GatewayNotReady" }),
      error: "",
      errorReason: "",
    });
  }

  /** Stop the workload, keep the data. */
  async function hibernate(record: AgentRecord): Promise<void> {
    await deps.containerd.stop(record.id);
    await deps.containerd.remove(record.id);
    await deps.gateway.stop(record.id);
    const link = await linkForRecord(record);
    await deps.network.destroy(link);
    await deps.sockets.close(record.id);
    await applyRuleset();
    await publishStatus(record.id, {
      ready: false,
      hibernated: true,
      hibernatedSince: new Date().toISOString(),
      address: "",
      sandboxReady: false,
      gatewayReady: false,
      sandboxRestarts: 0,
      sandboxTerminationReason: "",
    });
  }

  /** Stop the workload and forget the agent; the data directory goes too. */
  async function teardown(agentId: string): Promise<void> {
    await deps.containerd.stop(agentId);
    await deps.containerd.remove(agentId);
    await deps.gateway.stop(agentId);
    await deps.network.destroy(linkFor(agentId, 0)).catch(() => {});
    await deps.sockets.close(agentId);
    await applyRuleset();
  }

  async function applyRuleset(): Promise<void> {
    const links = (await deps.store.list()).flatMap((r) => {
      const index = r.status.address ? indexOfAddress(r.status.address) : null;
      return index === null ? [] : [linkFor(r.id, index)];
    });
    await deps.network.applyRuleset(links, {
      gatewayPort: deps.gatewayPort,
      sandboxPort: deps.sandboxPort,
    });
  }

  return {
    reconcile: schedule,

    async sweep() {
      const records = await deps.store.list();
      for (const record of records) await schedule(record.id);
      // Anything the runtime still holds that no record claims is left over
      // from a crash mid-delete, and nothing else will come back for it.
      const known = new Set(records.map((r) => r.id));
      for (const agentId of await deps.containerd.list()) {
        if (!known.has(agentId)) {
          deps.log("sandbox.sweep.orphan", { agentId });
          await teardown(agentId);
        }
      }
    },

    async start() {
      stopped = false;
      unsubscribe = deps.store.onChange((change) => {
        if (!stopped) void schedule(change.id);
      });
      await this.sweep();
    },

    async stop() {
      stopped = true;
      unsubscribe?.();
      unsubscribe = null;
      await Promise.allSettled([...inflight.values()]);
      await deps.gateway.stopAll();
    },
  };
}

const homeOf = (record: AgentRecord) => record.spec.agentHome ?? "/home/agent";

function sandboxEnv(
  record: AgentRecord,
  link: SandboxLink,
  caPath: string,
): Record<string, string> {
  const proxy = `http://${link.hostAddress}:3128`;
  const env: Record<string, string> = {
    HOME: homeOf(record),
    // Decorative, as it was under NetworkPolicy: the sandbox has no route to
    // anything else, so honoring it is not what makes egress go through the
    // gateway.
    HTTP_PROXY: proxy,
    HTTPS_PROXY: proxy,
    http_proxy: proxy,
    https_proxy: proxy,
    NO_PROXY: "localhost,127.0.0.1",
    SSL_CERT_FILE: caPath,
    REQUESTS_CA_BUNDLE: caPath,
    NODE_EXTRA_CA_CERTS: caPath,
    PORT: "8080",
  };
  for (const e of record.spec.env ?? []) env[e.name] = e.value;
  return env;
}
