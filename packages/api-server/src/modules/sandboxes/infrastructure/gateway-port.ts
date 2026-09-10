import { createHash } from "node:crypto";
import { exec, CommandError } from "./exec.js";

/**
 * The paired gateway: one Envoy per agent, holding that agent's credentials
 * and terminating its egress TLS.
 *
 * It runs as a systemd unit rather than a child process, which is what puts
 * it under its own uid — the boundary keeping one agent's credential files
 * out of another gateway's reach. Letting systemd drop the privilege means
 * the api-server never needs `CAP_SETUID` to do it, and the gateway gets
 * restart semantics and its own journal for free.
 *
 * A configuration change replaces the process rather than reloading it:
 * Envoy has no bootstrap reload, and a gateway still serving a superseded
 * credential set is exactly the state worth avoiding.
 */

export interface GatewayPort {
  /** (Re)starts the gateway when the configuration it is on has changed. */
  ensureRunning(agentId: string, config: string): Promise<void>;
  stop(agentId: string): Promise<void>;
  isRunning(agentId: string): Promise<boolean>;
  stopAll(): Promise<void>;
}

const unitFor = (agentId: string) => `dam-gateway@${agentId}.service`;

export function createGatewayPort(opts: {
  log: (message: string) => void;
}): GatewayPort {
  // The hash of the config each running gateway was started on, so an
  // unchanged reconcile does not bounce a working gateway.
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
      // `is-active` exits non-zero for every inactive state, which is the
      // answer rather than a failure.
      return (await exec("systemctl", ["is-active", unitFor(agentId)]).catch(
        () => "",
      )).trim() === "active";
    },

    async stopAll() {
      await Promise.all([...started.keys()].map((id) => this.stop(id)));
    },
  };
}
