import { useStore } from "../../../store.js";
import type { AgentView } from "../../../types.js";

export function useConfirmDeleteAgent() {
  const showConfirm = useStore((s) => s.showConfirm);
  return (agent: AgentView): Promise<boolean> =>
    showConfirm(
      <>
        This also deletes <strong>its workspace and sessions</strong>. There is
        no going back.
      </>,
      `Delete agent “${agent.name}”?`,
      { kind: "destructive", confirmLabel: "Delete agent" },
    );
}
