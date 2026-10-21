import type { StartupItemEnvFile } from "../infrastructure/startup-item-env.js";

export interface StartupItemEnv {
  apply(env: NodeJS.ProcessEnv): Promise<void>;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Keeps the agent's running Startup Items on the
 * runtime's current env. A process keeps the env it started with, so a new
 * env, a connection added or removed, reaches an item only when it starts
 * again: when the env file changed, every item that runs and has a script is
 * restarted through openrc, as the pod service is respawned. That covers a
 * boot too: items start before the runtime, from the file of the last run,
 * and the platform's first env push restarts them when it differs. An
 * unchanged env restarts nothing. Applies run one after another, so two quick
 * pushes never restart an item twice at once; one item's failed restart is
 * logged and the others still restart. Only a machine openrc booted has items.
 */
export function createStartupItemEnv(deps: {
  file: StartupItemEnvFile;
  available: () => boolean;
  running: () => Promise<string[]>;
  restart: (id: string) => Promise<string | null>;
  log: (msg: string) => void;
}): StartupItemEnv {
  let queue: Promise<void> = Promise.resolve();

  async function applyNow(env: NodeJS.ProcessEnv): Promise<void> {
    if (!deps.available()) return;
    if (!deps.file.write(env)) return;
    for (const id of await deps.running()) {
      const failure = await deps.restart(id);
      deps.log(
        failure === null
          ? `restarted Startup Item ${id} for a new env`
          : `Startup Item ${id} not restarted for a new env: ${failure}`,
      );
    }
  }

  return {
    apply(env) {
      const next = queue.then(() => applyNow(env));
      queue = next.catch(() => {});
      return next;
    },
  };
}
