import { createHash } from "node:crypto";
import { exec, CommandError } from "./exec.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: The paired gateway's lifecycle. It runs as a
 * systemd unit instance rather than a child process: systemd drops it to the
 * gateway account, so the api-server needs no privilege to do so, and gives
 * each instance a mount namespace holding only its own agent's credentials —
 * which is what isolates gateways that all share one account. A configuration
 * change replaces the process, because Envoy has no bootstrap reload and a
 * gateway on a superseded credential set is the state worth avoiding.
 */
export interface GatewayPort {
  ensureRunning(agentId: string, config: string): Promise<void>;
  stop(agentId: string): Promise<void>;
  isRunning(agentId: string): Promise<boolean>;
  stopAll(): Promise<void>;
}

const unitFor = (agentId: string) => `dam-gateway@${agentId}.service`;

export function createGatewayPort(opts: {
  log: (message: string) => void;
}): GatewayPort {
  const started = new Map<string, string>();

  return {
    async ensureRunning(agentId, config) {
      const hash = createHash("sha256").update(config).digest("hex");
      if (started.get(agentId) === hash && (await this.isRunning(agentId))) {
        return;
      }
      await exec("systemctl", ["restart", unitFor(agentId)]);
      started.set(agentId, hash);
    },

    async stop(agentId) {
      started.delete(agentId);
      await exec("systemctl", ["stop", unitFor(agentId)]).catch((err) => {
        if (!(err instanceof CommandError)) throw err;
        opts.log(`gateway ${agentId} did not stop cleanly: ${err.message}`);
      });
    },

    async isRunning(agentId) {
      return (
        (
          await exec("systemctl", ["is-active", unitFor(agentId)]).catch(
            () => "",
          )
        ).trim() === "active"
      );
    },

    async stopAll() {
      await Promise.all([...started.keys()].map((id) => this.stop(id)));
    },
  };
}
