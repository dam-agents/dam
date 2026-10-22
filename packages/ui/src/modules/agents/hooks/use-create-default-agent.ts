import { useStore } from "../../../store.js";
import type { AgentView } from "../../../types.js";
import { useUnlockedAvatars } from "../../getting-started/hooks/use-unlocked-avatars.js";
import { useTemplates } from "../../templates/api/queries.js";
import { useCreateAgent } from "../api/mutations.js";
import { useAgents } from "../api/queries.js";
import { defaultAvatar } from "../lib/default-avatar.js";
import { nextAgentName } from "../lib/sandbox-name.js";

export function useCreateDefaultAgent() {
  const list = useAgents().data?.list;
  const templates = useTemplates().data;
  const createAgent = useCreateAgent();
  const unlocked = useUnlockedAvatars();
  const selectAgent = useStore((s) => s.selectAgent);
  const setKitBrowserOpen = useStore((s) => s.setKitBrowserOpen);
  return {
    ready:
      list !== undefined && templates !== undefined && !createAgent.isPending,
    create: async ({ navigate = true } = {}): Promise<
      AgentView | undefined
    > => {
      if (!list || !templates) return;
      const harnesses = templates.filter((t) => t.category === "harness");
      const templateId = harnesses.some((t) => t.id === "default")
        ? "default"
        : (harnesses[0]?.id ?? null);
      try {
        const name = nextAgentName(list.map((a) => a.name));
        const agent = await createAgent.mutateAsync({
          name,
          egressPreset: "trusted",
          ...(templateId ? { templateId } : {}),
          avatar: defaultAvatar(name, unlocked, list),
        });
        if (navigate) {
          setKitBrowserOpen(false);
          selectAgent(agent.id);
        }
        return agent;
      } catch {
        return undefined;
      }
    },
  };
}
