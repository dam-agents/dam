import { Button } from "@/components/ui/button";
import { CARD_SURFACE } from "@/components/ui/card";
import { ToggleRow } from "@/components/ui/toggle-row";
import { cn } from "@/lib/utils";

import { useStore } from "../../../store.js";
import { useResetGettingStarted } from "../api/mutations.js";

export function ResetOnboardingCard() {
  const reset = useResetGettingStarted();
  const showConfirm = useStore((s) => s.showConfirm);

  return (
    <ToggleRow
      className={cn(CARD_SURFACE, "p-4")}
      title="Onboarding progress"
      description="Locks every avatar again and restarts the Get started checklist."
      control={
        <Button
          variant="outline"
          size="sm"
          disabled={reset.isPending}
          onClick={async () => {
            if (
              await showConfirm(
                "Every avatar locks again and the Get started checklist starts over. Avatars already on your agents stay.",
                "Reset onboarding progress?",
                { confirmLabel: "Reset" },
              )
            )
              reset.mutate();
          }}
        >
          Reset onboarding progress
        </Button>
      }
    />
  );
}
