import type { SecretRef } from "api-server-api";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { exec } from "../infrastructure/exec.js";
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
import type { RunscPort } from "../infrastructure/runsc-port.js";
import type { GatewayPort } from "../infrastructure/gateway-port.js";
import type { PkiPort } from "../infrastructure/pki-port.js";
import type { EnvoyConfigPort } from "../infrastructure/envoy-config-port.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: The reconcile loop. The agent record is intent,
 * the node is observed state, and this is the only thing that writes status.
 * It is change-driven off the store's change stream with a periodic sweep
 * behind it, for the reason every reconciler has one: an event that is missed,
 * or an action that fails, must be retried by something that does not depend on
 * the event. It ignores its own status writes, which would otherwise be a loop
 * with no fixed point.
 */
export interface SandboxSupervisorDeps {
  store: AgentStore;
  network: NetworkPort;
  runsc: RunscPort;
  gateway: GatewayPort;
  pki: PkiPort;
  envoyConfig: EnvoyConfigPort;
  sockets: {
    open(agentId: string): Promise<void>;
    close(agentId: string): Promise<void>;
  };
  agentsRoot: string;
  runRoot: string;
  gatewayPort: number;
  sandboxPort: number;
  gatewayUid: number;
  gatewayGid: number;
  defaultIdleTimeoutMs: number;
  sandboxCommand: string[];
  registryAuth: {
    materialize(ref: SecretRef, dir: string): Promise<string>;
  };
  harnessBaseUrl: string;
  log: (message: string, fields?: Record<string, unknown>) => void;
}

export interface SandboxSupervisor {
  reconcile(agentId: string): Promise<void>;
  sweep(): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
}

export function createSandboxSupervisor(
  deps: SandboxSupervisorDeps,
): SandboxSupervisor {
  const inflight = new Map<string, Promise<void>>();
  const queued = new Set<string>();
  const liveLinks = new Map<string, SandboxLink>();
  let unsubscribe: (() => void) | null = null;
  let stopped = false;

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

    await mkdir(layout.root, { recursive: true, mode: 0o751 });
    for (const dir of [layout.work, layout.home, layout.scratch]) {
      await mkdir(dir, { recursive: true, mode: 0o750 });
    }
    const caCert = await deps.pki.ensureCa();
    await mkdir(layout.root + "/ca", { recursive: true, mode: 0o755 });
    await writeFile(layout.caCert, caCert, { mode: 0o644 });

    await deps.sockets.open(record.id);
    await deps.network.create(link);
    liveLinks.set(record.id, link);
    await applyRuleset();

    const { config, hosts } = await deps.envoyConfig.render({
      record,
      link,
      layout,
      sockets,
    });
    await deps.pki.ensureLeaf(layout.leafTls, hosts);
    await mkdir(dirname(layout.gatewayConfig), {
      recursive: true,
      mode: 0o750,
    });
    await writeFile(layout.gatewayConfig, config, { mode: 0o640 });
    await exec("chown", [
      "-R",
      `${deps.gatewayUid}:${deps.gatewayGid}`,
      dirname(layout.gatewayConfig),
    ]);
    await deps.gateway.ensureRunning(record.id, config);

    await deps.runsc.ensureRunning({
      agentId: record.id,
      image: record.spec.image,
      ...(record.spec.registryAuth
        ? {
            registryAuthPath: await deps.registryAuth.materialize(
              record.spec.registryAuth,
              layout.registryAuth,
            ),
          }
        : {}),
      netns: link.netns,
      env: sandboxEnv(record, link, deps),
      mounts: [
        { source: layout.home, target: homeOf(record) },
        { source: layout.work, target: `${homeOf(record)}/work` },
        { source: layout.caCert, target: SANDBOX_CA_PATH, readOnly: true },
      ],
      stateDir: layout.sandbox,
      ...(deps.sandboxCommand.length ? { command: deps.sandboxCommand } : {}),
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
    });

    const state = await deps.runsc.inspect(record.id);
    const sandboxReady = state?.running === true;
    const gatewayReady = await deps.gateway.isRunning(record.id);
    await publishStatus(record.id, {
      ready: sandboxReady && gatewayReady,
      hibernated: false,
      address: link.sandboxAddress,
      sandboxReady,
      ...(sandboxReady
        ? {}
        : { sandboxNotReadyReason: state?.reason ?? "SandboxNotReady" }),
      ...(state?.reason ? { sandboxTerminationReason: state.reason } : {}),
      sandboxRestarts: state?.restarts ?? 0,
      gatewayReady,
      ...(gatewayReady ? {} : { gatewayNotReadyReason: "GatewayNotReady" }),
      error: "",
      errorReason: "",
    });
  }

  async function hibernate(record: AgentRecord): Promise<void> {
    await deps.runsc.stop(
      record.id,
      layoutFor(deps.agentsRoot, record.id).sandbox,
    );
    await deps.gateway.stop(record.id);
    const link = await linkForRecord(record);
    await deps.network.destroy(link);
    liveLinks.delete(record.id);
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

  async function teardown(agentId: string): Promise<void> {
    await deps.runsc.stop(agentId, layoutFor(deps.agentsRoot, agentId).sandbox);
    await deps.gateway.stop(agentId);
    const known = liveLinks.get(agentId);
    if (known) await deps.network.destroy(known).catch(() => {});
    liveLinks.delete(agentId);
    await deps.sockets.close(agentId);
    await applyRuleset();
  }

  async function applyRuleset(): Promise<void> {
    await deps.network.applyRuleset([...liveLinks.values()], {
      gatewayPort: deps.gatewayPort,
    });
  }

  return {
    reconcile: schedule,

    async sweep() {
      const records = await deps.store.list();
      for (const record of records) {
        const index = record.status.address
          ? indexOfAddress(record.status.address)
          : null;
        if (index !== null && !liveLinks.has(record.id)) {
          liveLinks.set(record.id, linkFor(record.id, index));
        }
      }
      for (const record of records) await schedule(record.id);
      const known = new Set(records.map((r) => r.id));
      for (const agentId of await deps.runsc.list()) {
        if (!known.has(agentId)) {
          deps.log("sandbox.sweep.orphan", { agentId });
          await teardown(agentId);
        }
      }
    },

    async start() {
      stopped = false;
      unsubscribe = deps.store.onChange((change) => {
        if (stopped) return;
        if (change.type === "upsert" && change.statusOnly) return;
        void schedule(change.id);
      });
      void this.sweep().catch((err: unknown) => {
        deps.log("sandbox.sweep.failed", {
          error: err instanceof Error ? err.message : String(err),
        });
      });
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

const SANDBOX_CA_PATH = "/etc/platform/ca/ca.crt";

function sandboxEnv(
  record: AgentRecord,
  link: SandboxLink,
  deps: SandboxSupervisorDeps,
): Record<string, string> {
  const home = homeOf(record);
  const proxy = `http://${link.hostAddress}:${deps.gatewayPort}`;
  const harness = deps.harnessBaseUrl.replace(/\/+$/, "");
  const env: Record<string, string> = {
    HOME: home,
    HTTP_PROXY: proxy,
    HTTPS_PROXY: proxy,
    http_proxy: proxy,
    https_proxy: proxy,
    NO_PROXY: "localhost,127.0.0.1,::1",
    no_proxy: "localhost,127.0.0.1,::1",
    JAVA_TOOL_OPTIONS: `-Duser.home=${home} -Dhttp.proxyHost=${link.hostAddress} -Dhttp.proxyPort=${deps.gatewayPort} -Dhttps.proxyHost=${link.hostAddress} -Dhttps.proxyPort=${deps.gatewayPort}`,
    NODE_EXTRA_CA_CERTS: SANDBOX_CA_PATH,
    NODE_USE_ENV_PROXY: "1",
    GIT_HTTP_PROXY_AUTHMETHOD: "basic",
    PLATFORM_AGENT_ID: record.id,
    API_SERVER_URL: harness,
    PLATFORM_MCP_URL: `${harness}/api/agents/${record.id}/mcp`,
    PLATFORM_POD_FILES_EVENTS_URL: `${harness}/api/agents/${record.id}/pod-files/events`,
    PORT: String(deps.sandboxPort),
  };
  for (const e of record.spec.env ?? []) env[e.name] = e.value;
  return env;
}
