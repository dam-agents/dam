import type { GettingStartedTask } from "api-server-api";
import { useCallback } from "react";
import { match } from "ts-pattern";

import { useDockDraftGuard } from "../../../hooks/use-dock-draft-guard.js";
import { useStore } from "../../../store.js";
import { useAgentsList } from "../../agents/api/queries.js";
import { useCreateDefaultAgent } from "../../agents/hooks/use-create-default-agent.js";
import { newestAgent } from "../lib/newest-agent.js";
import { FIRST_MESSAGE_PREFILL, SCHEDULE_PREFILL } from "../lib/tasks.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: A click on a checklist task takes the user to the
 * place where they do it. Tasks done on an Agent open the newest one, and a
 * chat task leaves a starting line in its composer. With no Agent yet, those
 * tasks create one first, because each needs an Agent to act on.
 */
export function useStartTask(): (task: GettingStartedTask) => Promise<void> {
  const agents = useAgentsList();
  const createDefault = useCreateDefaultAgent();
  const confirmDiscard = useDockDraftGuard();
  const appendNewSessionDraft = useStore((s) => s.appendNewSessionDraft);
  const selectAgent = useStore((s) => s.selectAgent);
  const setMobileScreen = useStore((s) => s.setMobileScreen);
  const navigateToSettings = useStore((s) => s.navigateToSettings);
  const navigateToSandboxHome = useStore((s) => s.navigateToSandboxHome);
  const setKitBrowserOpen = useStore((s) => s.setKitBrowserOpen);
  const setView = useStore((s) => s.setView);

  return useCallback(
    async (task) => {
      const agent = newestAgent(agents);
      const openChat = async (prefill: string) => {
        if (!agent) return createDefault.create();
        if (!(await confirmDiscard())) return;
        appendNewSessionDraft(agent.id, prefill);
        selectAgent(agent.id);
        setMobileScreen("chat");
      };
      const openAgentSection = async (section: "skills" | "channels") => {
        if (!agent) return createDefault.create();
        navigateToSandboxHome(agent.id, section);
      };
      await match(task)
        .with("create-agent", () => createDefault.create())
        .with("send-message", () => openChat(FIRST_MESSAGE_PREFILL))
        .with("create-connection", async () =>
          navigateToSettings("connections"),
        )
        .with("add-skill", () => openAgentSection("skills"))
        .with("apply-starter-kit", async () => setKitBrowserOpen(true))
        .with("create-schedule", () => openChat(SCHEDULE_PREFILL))
        .with("create-artifact", async () => setView("artifacts"))
        .with("connect-slack", () => openAgentSection("channels"))
        .exhaustive();
    },
    [
      agents,
      createDefault,
      confirmDiscard,
      appendNewSessionDraft,
      selectAgent,
      setMobileScreen,
      navigateToSettings,
      navigateToSandboxHome,
      setKitBrowserOpen,
      setView,
    ],
  );
}
