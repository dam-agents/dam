import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

import { useStore } from "../../../store.js";

const COLLAPSED = "collapsed";
const EXPANDED = "expanded";

export function ToolActivitySetting() {
  const expanded = useStore((s) => s.toolActivityExpanded);
  const setExpanded = useStore((s) => s.setToolActivityExpanded);

  return (
    <section className="mb-8 flex flex-col gap-3">
      <div>
        <h2 className="text-base font-medium text-foreground">Tool activity</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          What an agent did in a reply, folded into one line. Choose how it
          starts.
        </p>
      </div>
      <RadioGroup
        aria-label="Tool activity"
        className="flex-row gap-6"
        value={expanded ? EXPANDED : COLLAPSED}
        onValueChange={(value) => setExpanded(value === EXPANDED)}
      >
        <RadioGroupItem
          value={COLLAPSED}
          label="Collapsed"
          className="w-auto"
        />
        <RadioGroupItem value={EXPANDED} label="Expanded" className="w-auto" />
      </RadioGroup>
    </section>
  );
}
