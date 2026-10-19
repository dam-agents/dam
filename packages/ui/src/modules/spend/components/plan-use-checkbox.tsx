import { useId } from "react";

import { Checkbox } from "@/components/ui/checkbox";

import {
  useSetShowPlanUse,
  useShowPlanUse,
} from "../hooks/use-spend-preferences.js";
import { PLAN_USE_HELP, SHOW_PLAN_USE } from "../lib/copy.js";
import { HelpTip } from "./help-tip.js";

export function PlanUseCheckbox() {
  const id = useId();
  const showPlanUse = useShowPlanUse();
  const setShowPlanUse = useSetShowPlanUse();
  return (
    <div className="flex items-center gap-1.5">
      <label
        htmlFor={id}
        className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground"
      >
        <Checkbox
          id={id}
          checked={showPlanUse}
          onCheckedChange={(checked) => setShowPlanUse(checked === true)}
        />
        {SHOW_PLAN_USE}
      </label>
      <HelpTip content={PLAN_USE_HELP} />
    </div>
  );
}
