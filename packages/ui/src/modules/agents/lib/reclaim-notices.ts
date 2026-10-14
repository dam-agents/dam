import type { Toast } from "../../../lib/toast.js";
import type { AgentView } from "../../../types.js";

type ReclaimedAgent = Pick<AgentView, "id" | "name" | "reclaimed">;

const FREED: Record<NonNullable<AgentView["reclaimed"]>["for"], string> = {
  memory: "to free memory for your other agents",
  compute: "to make room for an agent you started",
};

export function reclaimSentence(agent: ReclaimedAgent): string | undefined {
  return agent.reclaimed
    ? `Put to sleep automatically ${FREED[agent.reclaimed.for]}. Wake it whenever you need it.`
    : undefined;
}

export function nextReclaimNotices(
  previous: ReadonlyMap<string, string | null>,
  agents: readonly ReclaimedAgent[],
): { marks: Map<string, string | null>; toasts: Toast[] } {
  const marks = new Map<string, string | null>();
  const toasts: Toast[] = [];
  for (const agent of agents) {
    const reclaimed = agent.reclaimed;
    if (
      reclaimed &&
      previous.has(agent.id) &&
      previous.get(agent.id) !== reclaimed.at
    ) {
      toasts.push({
        kind: "info",
        message: `${agent.name} was put to sleep automatically ${FREED[reclaimed.for]}`,
      });
    }
    marks.set(agent.id, reclaimed?.at ?? null);
  }
  return { marks, toasts };
}
