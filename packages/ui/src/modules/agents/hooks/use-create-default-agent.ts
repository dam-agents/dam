import { leastUsedCharacter } from "api-server-api/avatar/svg";

import { useStore } from "../../../store.js";
import { useVmRuntime } from "../../features/hooks/use-vm-runtime.js";
import {
  defaultHarnessId,
  imageCatalogue,
} from "../../sandboxes/lib/image-catalogue.js";
import { useTemplates } from "../../templates/api/queries.js";
import { useCreateAgent } from "../api/mutations.js";
import { useAgents } from "../api/queries.js";
import { resolveCharacter } from "../components/avatar/agent-avatar.js";
import { AGENT_NAME_PREFIX, nextSandboxName } from "../lib/sandbox-name.js";

export function useCreateDefaultAgent() {
  const list = useAgents().data?.list;
  const templates = useTemplates().data;
  const vmRuntime = useVmRuntime();
  const createAgent = useCreateAgent();
  const selectAgent = useStore((s) => s.selectAgent);
  const setKitBrowserOpen = useStore((s) => s.setKitBrowserOpen);
  return {
    ready:
      list !== undefined &&
      templates !== undefined &&
      vmRuntime.answered &&
      !createAgent.isPending,
    create: async () => {
      if (!list || !templates) return;
      const templateId = defaultHarnessId(imageCatalogue(templates).harnesses);
      try {
        const agent = await createAgent.mutateAsync({
          name: nextSandboxName(
            AGENT_NAME_PREFIX,
            list.map((a) => a.name),
          ),
          egressPreset: "trusted",
          ...(templateId ? { templateId } : {}),
          ...(vmRuntime.vm ? { vm: true } : {}),
          avatar: leastUsedCharacter(
            list.map((a) => resolveCharacter(a.name, a.avatar)),
          ),
        });
        setKitBrowserOpen(false);
        selectAgent(agent.id);
      } catch {}
    },
  };
}
