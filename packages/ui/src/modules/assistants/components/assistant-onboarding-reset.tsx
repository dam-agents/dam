import { useMutation } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";

import { getBrand } from "../../../brand.js";
import { queryClient } from "../../../query-client.js";
import { useStore } from "../../../store.js";
import { trpc } from "../../../trpc.js";
import { agentsKeys } from "../../agents/api/queries.js";
import { useAssistantState } from "../api/assistant-state.js";
import { runResetOnboarding } from "../lib/reset-onboarding.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: The button under the assistant's row in Experimental
 * features that starts this person's onboarding over, after a confirm that says
 * what starts again and that nothing is deleted. On confirm it awaits the fresh
 * answers — the assistant's record, the feature flags and the checklist — then
 * releases the one-time landing and goes to the entry route, so the person is
 * routed by the same first-open logic a new person is, never by the answers the
 * cache held before the reset.
 */
export function AssistantOnboardingReset() {
  const assistantName = getBrand().assistantName;
  const showConfirm = useStore((s) => s.showConfirm);
  const reset = useMutation(trpc.assistants.resetOnboarding.mutationOptions());
  const state = useAssistantState();

  return (
    <div className="flex flex-col items-start gap-2 px-1 pb-2">
      <p className="text-sm text-muted-foreground">
        Start your onboarding over: {assistantName} greets you as on your first
        open, and the Get started checklist begins again. Nothing is deleted.
      </p>
      <Button
        variant="outline"
        disabled={reset.isPending}
        data-testid="assistant-reset-onboarding"
        onClick={() =>
          void runResetOnboarding({
            assistantName,
            confirm: showConfirm,
            reset: () => reset.mutateAsync(),
            refresh: () =>
              Promise.all([
                queryClient.invalidateQueries({
                  queryKey: trpc.assistants.state.queryKey(),
                }),
                queryClient.invalidateQueries({
                  queryKey: trpc.features.flags.queryKey(),
                }),
                queryClient.invalidateQueries({
                  queryKey: trpc.gettingStarted.progress.queryKey(),
                }),
                // UNIT_BOUNDARY_DESCRIPTION: the reset may have created the assistant again, and the landing needs it in the list before it decides.
                queryClient.invalidateQueries({ queryKey: agentsKeys.root }),
              ]),
            releaseLanding: () => {
              void state.refetch();
              useStore.getState().releaseAssistantLanding();
            },
            goHome: () => useStore.getState().setView("home"),
          })
        }
      >
        Reset user onboarding
      </Button>
    </div>
  );
}
