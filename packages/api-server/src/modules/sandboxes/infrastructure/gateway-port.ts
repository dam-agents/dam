import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

/**
 * The paired gateway: one Envoy process per agent, holding that agent's
 * credentials and terminating its egress TLS.
 *
 * It runs in the host namespace (it needs the internet and the api-server's
 * sockets) under its own uid, which is what keeps one agent's credential
 * files out of another gateway's reach. A configuration change replaces the
 * process rather than reloading it: Envoy has no bootstrap reload, and a
 * gateway still serving a superseded credential set is exactly the state the
 * controller used to evict pods to avoid.
 */

export interface GatewayPort {
  /** Writes the config and (re)starts Envoy if the config changed. */
  ensureRunning(agentId: string, configPath: string, config: string): Promise<void>;
  stop(agentId: string): Promise<void>;
  isRunning(agentId: string): boolean;
  running(): string[];
  stopAll(): Promise<void>;
}

interface Gateway {
  process: ChildProcess;
  configHash: string;
}

export function createGatewayPort(opts: {
  envoyBinary?: string;
  /** uid the gateway drops to; it must own the credential files. */
  uid?: number;
  gid?: number;
  log: (message: string) => void;
}): GatewayPort {
  const binary = opts.envoyBinary ?? "envoy";
  const gateways = new Map<string, Gateway>();

  async function start(
    agentId: string,
    configPath: string,
    configHash: string,
  ): Promise<void> {
    const child = spawn(
      binary,
      [
        "--config-path", configPath,
        "--base-id", String(baseId(agentId)),
        "--log-level", "warn",
        "--service-node", agentId,
        "--service-cluster", "platform-credential-injector",
      ],
      {
        stdio: ["ignore", "inherit", "inherit"],
        ...(opts.uid !== undefined ? { uid: opts.uid } : {}),
        ...(opts.gid !== undefined ? { gid: opts.gid } : {}),
      },
    );
    gateways.set(agentId, { process: child, configHash });
    child.on("exit", (code, signal) => {
      if (gateways.get(agentId)?.process !== child) return;
      gateways.delete(agentId);
      opts.log(
        `gateway ${agentId} exited (${signal ?? code}) — the next reconcile restarts it`,
      );
    });
  }

  return {
    async ensureRunning(agentId, configPath, config) {
      const hash = createHash("sha256").update(config).digest("hex");
      const current = gateways.get(agentId);
      if (current && current.configHash === hash) return;

      await mkdir(dirname(configPath), { recursive: true, mode: 0o750 });
      await writeFile(configPath, config, { mode: 0o640 });
      if (current) await this.stop(agentId);
      await start(agentId, configPath, hash);
    },

    async stop(agentId) {
      const gateway = gateways.get(agentId);
      if (!gateway) return;
      gateways.delete(agentId);
      gateway.process.kill("SIGTERM");
      await once(gateway.process, 10_000);
      if (gateway.process.exitCode === null) gateway.process.kill("SIGKILL");
    },

    isRunning: (agentId) => gateways.has(agentId),
    running: () => [...gateways.keys()],

    async stopAll() {
      await Promise.all([...gateways.keys()].map((id) => this.stop(id)));
    },
  };
}

/**
 * Envoy's shared-memory region is keyed by base id, so two gateways sharing
 * one would refuse to start. Derived from the agent id rather than counted,
 * so a restart of this process reclaims the same id for the same agent.
 */
function baseId(agentId: string): number {
  const digest = createHash("sha256").update(agentId).digest();
  return digest.readUInt32BE(0) % 2_000_000;
}

function once(child: ChildProcess, timeoutMs: number): Promise<void> {
  if (child.exitCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    timer.unref();
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}
