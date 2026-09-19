import { Gift } from "@carbon/icons-react";
import { useState } from "react";

import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";

import {
  readPersistedFlag,
  writePersistedFlag,
} from "../../../lib/persisted-prefs.js";
import { useAgentsList } from "../../agents/api/queries.js";
import {
  onboardingBadge,
  onboardingProgress,
} from "../../agents/utils/agent-kind.js";
import { ChatColumn } from "../../sessions/components/chat-column.js";
import { useKitName } from "../hooks/use-kit-name.js";
import { OnboardingChecklistCard } from "./onboarding-checklist-card.js";

const dismissKey = (agentId: string) =>
  `platform-onboarding-bar-dismissed:${agentId}`;

export function OnboardingBar({ agentId }: { agentId: string | null }) {
  const agents = useAgentsList();
  const agent = agentId ? agents.find((a) => a.id === agentId) : undefined;
  const badge = agent ? onboardingBadge(agent) : null;
  const kitName = useKitName(agent?.starterKit ?? null, badge !== null);
  const [dismissed, setDismissed] = useState(() =>
    agentId ? readPersistedFlag(dismissKey(agentId), false) : false,
  );
  if (!agentId || !agent || !badge || dismissed) return null;

  const progress = onboardingProgress(agent.onboardingSteps);
  const dismiss = () => {
    writePersistedFlag(dismissKey(agentId), true);
    setDismissed(true);
  };

  return (
    <div className="px-4 md:px-8" data-testid="onboarding-bar">
      <ChatColumn>
        <div className="mb-3 flex items-center justify-between gap-3 rounded-xl border border-kit-line bg-kit-surface px-4 py-2">
          <span className="flex min-w-0 items-center gap-2 text-sm font-medium text-kit">
            <Gift size={16} className="shrink-0" />
            <span className="truncate">{kitName}</span>
          </span>
          <HoverCard openDelay={150} closeDelay={300}>
            <HoverCardTrigger asChild>
              <button
                type="button"
                className="shrink-0 text-sm text-kit hover:underline"
              >
                {progress
                  ? `${progress.done}/${progress.total} Onboarding tasks complete`
                  : "Onboarding in progress"}
              </button>
            </HoverCardTrigger>
            <HoverCardContent side="top" align="end" className="w-72">
              <OnboardingChecklistCard
                title="Finish onboarding"
                steps={agent.onboardingSteps}
                onDismiss={dismiss}
              />
            </HoverCardContent>
          </HoverCard>
        </div>
      </ChatColumn>
    </div>
  );
}
