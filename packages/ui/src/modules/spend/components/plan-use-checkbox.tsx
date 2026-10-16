import { useId } from "react";

import { Checkbox } from "@/components/ui/checkbox";

import {
  useSetShowPlanUse,
  useShowPlanUse,
} from "../hooks/use-spend-preferences.js";
import { SHOW_PLAN_USE } from "../lib/copy.js";

export function PlanUseCheckbox() {
  const id = useId();
  const showPlanUse = useShowPlanUse();
  const setShowPlanUse = useSetShowPlanUse();
  return (
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
  );
}
