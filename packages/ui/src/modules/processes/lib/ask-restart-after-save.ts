import type { PendingRestart } from "agent-runtime-api";

import { getErrorMessage } from "../../../lib/errors.js";
import { emitToast } from "../../../lib/toast.js";
import { queryClient } from "../../../query-client.js";
import { useStore } from "../../../store.js";
import { processKeys } from "../api/keys.js";
import {
  applyPendingRestart,
  readPendingRestart,
} from "../api/pending-restart.js";
import { countRestartStops, describeRestartStops } from "./process-copy.js";

const CHECK_EVERY_MS = 1_500;
const CHECK_FOR_MS = 12_000;

const checkUntil = new Map<string, number>();

export function askToRestartAfterSave(agentId: string): void {
  const checking = checkUntil.has(agentId);
  checkUntil.set(agentId, Date.now() + CHECK_FOR_MS);
  if (checking) return;
  void waitForPendingRestart(agentId).then((pending) => {
    checkUntil.delete(agentId);
    if (pending) void askToRestart(agentId, pending);
  });
}

async function waitForPendingRestart(
  agentId: string,
): Promise<PendingRestart | null> {
  while (Date.now() < (checkUntil.get(agentId) ?? 0)) {
    await new Promise((resolve) => setTimeout(resolve, CHECK_EVERY_MS));
    if (useStore.getState().dialog?.open) continue;
    let pending: PendingRestart | null;
    try {
      pending = await readPendingRestart(agentId);
    } catch {
      return null;
    }
    if (pending) return pending;
  }
  return null;
}

async function askToRestart(
  agentId: string,
  pending: PendingRestart,
): Promise<void> {
  const one = pending.blockingTasks === 1;
  const restart = await useStore
    .getState()
    .showConfirm(
      `The change applies when the agent restarts. A restart now stops ${describeRestartStops(pending.stops)}. If you wait, it applies when ${one ? "the task that keeps the agent awake finishes" : `the ${pending.blockingTasks} tasks that keep the agent awake finish`}.`,
      "Restart the agent now?",
      {
        confirmLabel: `Restart now (stops ${countRestartStops(pending.stops)})`,
        cancelLabel: one ? "Apply when it finishes" : "Apply when they finish",
      },
    );
  if (!restart) return;
  try {
    await applyPendingRestart(agentId);
  } catch (error) {
    const detail = getErrorMessage(error, "");
    emitToast({
      kind: "error",
      message: detail
        ? `Couldn't restart the agent: ${detail}`
        : "Couldn't restart the agent",
    });
  } finally {
    void queryClient.invalidateQueries({
      queryKey: processKeys.agent(agentId),
    });
  }
}
