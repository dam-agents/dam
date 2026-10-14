import { Button } from "@/components/ui/button";
import { CARD_SURFACE } from "@/components/ui/card";
import { cn } from "@/lib/utils";

import { useStore } from "../../../store.js";
import { useResetGettingStarted } from "../api/mutations.js";

export function ResetOnboardingCard() {
  const reset = useResetGettingStarted();
  const showConfirm = useStore((s) => s.showConfirm);

  return (
    <div
      className={cn(CARD_SURFACE, "flex items-start justify-between gap-4 p-4")}
    >
      <span>
        <span className="block text-sm font-medium text-foreground">
          Onboarding progress
        </span>
        <span className="mt-0.5 block text-sm text-muted-foreground">
          Locks every avatar again and restarts the Get started checklist.
        </span>
      </span>
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
    </div>
  );
}
