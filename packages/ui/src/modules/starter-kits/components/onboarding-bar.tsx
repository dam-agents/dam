import { Box } from "@carbon/icons-react";

import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";

import { useAgentsList } from "../../agents/api/queries.js";
import {
  onboardingBadge,
  onboardingProgress,
} from "../../agents/utils/agent-kind.js";
import { ChatColumn } from "../../sessions/components/chat-column.js";
import { useKitName } from "../hooks/use-kit-name.js";
import { OnboardingChecklistCard } from "./onboarding-checklist-card.js";

export function OnboardingBar({ agentId }: { agentId: string | null }) {
  const agents = useAgentsList();
  const agent = agentId ? agents.find((a) => a.id === agentId) : undefined;
  const badge = agent ? onboardingBadge(agent) : null;
  const kitName = useKitName(agent?.starterKit ?? null, badge !== null);
  if (!agentId || !agent || !badge) return null;

  const progress = onboardingProgress(agent.onboardingSteps);

  return (
    <div className="px-4 md:px-8" data-testid="onboarding-bar">
      <ChatColumn>
        <div className="mb-3 flex items-center justify-between gap-3 rounded-xl border border-kit-line bg-kit-surface px-4 py-2">
          <span className="flex min-w-0 items-center gap-2 text-sm font-medium text-kit">
            <Box size={16} className="shrink-0" />
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
              />
            </HoverCardContent>
          </HoverCard>
        </div>
      </ChatColumn>
    </div>
  );
}
