import { useMarkUnlockSeen } from "../../getting-started/api/mutations.js";
import { useGettingStarted } from "../../getting-started/api/queries.js";
import { UnlockCelebration } from "../../getting-started/components/unlock-celebration.js";
import { assistantUnlockToCelebrate } from "../lib/assistant-unlock.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: the avatar an Agent the platform made unlocks, met
 * where the person first meets the Agent: the first chat. The unlock is recorded
 * unseen when the Agent is created, and this plays the Get started celebration
 * for it — the same component, with the same words and the same "Nice" — then
 * marks it seen, so the checklist counts the task from then on. A reset deletes
 * the unlock rows, so the next create is celebrated here again.
 * While a modal or a dialog covers it, it waits: the countdown that marks the
 * unlock seen must not run where nobody can see the celebration, which is what
 * an account with no provider Connection meets first.
 */
export function AssistantUnlockCelebration({
  covered = false,
}: {
  covered?: boolean;
}) {
  const progress = useGettingStarted().data;
  const markSeen = useMarkUnlockSeen();
  const celebrating = assistantUnlockToCelebrate(progress);
  if (celebrating === null) return null;
  return (
    <div data-testid="assistant-unlock-celebration" className="px-4 pb-2">
      <UnlockCelebration
        key={celebrating.unlock.task}
        character={celebrating.unlock.character}
        variant={celebrating.variant}
        covered={covered}
        onFinished={() => markSeen.mutate({ task: celebrating.unlock.task })}
      />
    </div>
  );
}
