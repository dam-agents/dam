import { useMutation } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { CARD_SURFACE } from "@/components/ui/card";
import { ToggleRow } from "@/components/ui/toggle-row";
import { cn } from "@/lib/utils";

import { queryClient } from "../../../query-client.js";
import { useStore } from "../../../store.js";
import { trpc } from "../../../trpc.js";
import { agentsKeys } from "../../agents/api/queries.js";
import {
  forgetAssistantUsed,
  useAssistantOn,
  useAssistantState,
} from "../../assistants/api/assistant-state.js";
import { runResetOnboarding } from "../lib/reset-onboarding.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: The one onboarding reset, the card at the bottom of
 * Settings › Experimental features: it asks first, and on confirm it restarts the
 * Get started checklist and, for a person the assistant is on for, gives them a
 * first open in it — then releases the one-time landing and goes to the entry
 * route, so the same first-open logic a new person meets decides on fresh answers
 * rather than on the ones the cache held before the reset. A person the assistant
 * is off for keeps where they are: only the checklist and its avatars start over.
 */
export function ResetOnboardingCard() {
  const showConfirm = useStore((s) => s.showConfirm);
  const onboard = useAssistantOn();
  const reset = useMutation(trpc.assistants.resetOnboarding.mutationOptions());
  const state = useAssistantState();

  return (
    <ToggleRow
      className={cn(CARD_SURFACE, "p-4")}
      title="Onboarding progress"
      description="Restarts your onboarding. Nothing in your account is deleted."
      control={
        <Button
          variant="outline"
          size="sm"
          disabled={reset.isPending}
          data-testid="reset-onboarding"
          onClick={() =>
            void runResetOnboarding({
              confirm: showConfirm,
              onboard,
              reset: () => reset.mutateAsync(),
              refresh: () =>
                Promise.all([
                  queryClient.invalidateQueries({
                    queryKey: trpc.gettingStarted.progress.queryKey(),
                  }),
                  queryClient.invalidateQueries({
                    queryKey: trpc.assistants.state.queryKey(),
                  }),
                  // UNIT_BOUNDARY_DESCRIPTION: the reset may have made the assistant again, and the landing needs it in the list before it decides.
                  queryClient.invalidateQueries({ queryKey: agentsKeys.root }),
                ]),
              releaseLanding: () => {
                // UNIT_BOUNDARY_DESCRIPTION: this tab may still hold its own unconfirmed mark for the message that brought it here, and the reset would not bring the greeting back while it does.
                forgetAssistantUsed();
                void state.refetch();
                useStore.getState().releaseAssistantLanding();
              },
              goHome: () => useStore.getState().setView("home"),
            })
          }
        >
          Reset onboarding progress
        </Button>
      }
    />
  );
}
