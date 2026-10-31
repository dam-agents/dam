import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

import { useStore } from "../../../store.js";

const COLLAPSED = "collapsed";
const EXPANDED = "expanded";

export function ThinkingSetting() {
  const expanded = useStore((s) => s.thinkingExpandedWhileStreaming);
  const setExpanded = useStore((s) => s.setThinkingExpandedWhileStreaming);

  return (
    <section className="mb-8 flex flex-col gap-3">
      <div>
        <h2 className="text-base font-medium text-foreground">
          Thinking while streaming
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          A model's reasoning as it arrives. Collapsed shows only its latest
          line until you open it.
        </p>
      </div>
      <RadioGroup
        aria-label="Thinking while streaming"
        className="flex-row gap-6"
        value={expanded ? EXPANDED : COLLAPSED}
        onValueChange={(value) => setExpanded(value === EXPANDED)}
      >
        <RadioGroupItem value={EXPANDED} label="Expanded" className="w-auto" />
        <RadioGroupItem
          value={COLLAPSED}
          label="Collapsed"
          className="w-auto"
        />
      </RadioGroup>
    </section>
  );
}
