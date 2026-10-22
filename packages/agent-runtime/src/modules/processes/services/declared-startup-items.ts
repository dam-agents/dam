import type { StartupItemsEventPayload } from "agent-runtime-api";
import { startupItemScript } from "../domain/startup-item-script.js";
import type { StartupItemStore } from "../infrastructure/startup-items.js";

export type DeclareStartupItems = (
  payload: StartupItemsEventPayload,
) => Promise<void>;

/**
 * UNIT_BOUNDARY_DESCRIPTION: Writes the Startup Items a starter kit declared,
 * once, when the agent is created: each one's openrc script, its boot link
 * when the kit has it on, and a start now on a machine openrc booted. A
 * script already there under the same name is the agent's and is left as it
 * is, so a kit never overwrites an item the agent wrote or changed; the same
 * script again, from an event delivered twice, is carried on. A start that
 * fails is logged and the item stays listed in the Processes panel with its
 * log, as any item the agent wrote; only a write that fails fails the event.
 */
export function createDeclaredStartupItems(deps: {
  store: StartupItemStore;
  agentHome: string;
  log: (msg: string) => void;
}): DeclareStartupItems {
  return async ({ kit, items }) => {
    const origin = `A Startup Item of the starter kit ${kit.replace(/[\r\n]/g, " ")}, written when the agent was created.`;
    for (const item of items) {
      const written = deps.store.create(
        item.name,
        startupItemScript(item, deps.agentHome, origin),
      );
      if (written === "taken") {
        deps.log(
          `Startup Item ${item.name} of the kit not written: the agent has its own`,
        );
        continue;
      }
      await deps.store.setDisabled(item.name, !item.enabled);
      if (!item.enabled || !deps.store.available()) continue;
      const failure = await deps.store.run("start", item.name);
      deps.log(
        failure === null
          ? `started Startup Item ${item.name} of the kit`
          : `Startup Item ${item.name} of the kit did not start: ${failure}`,
      );
    }
  };
}
