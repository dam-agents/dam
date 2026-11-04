import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

import { useStore } from "../../../store.js";
import { OptionField } from "./option-field.js";

const COLLAPSED = "collapsed";
const EXPANDED = "expanded";
const TITLE = "Thinking while it writes";

export function ThinkingSetting() {
  const expanded = useStore((s) => s.thinkingExpandedWhileStreaming);
  const setExpanded = useStore((s) => s.setThinkingExpandedWhileStreaming);

  return (
    <section className="mb-8">
      <OptionField title={TITLE}>
        <RadioGroup
          aria-label={TITLE}
          className="flex-row gap-6"
          value={expanded ? EXPANDED : COLLAPSED}
          onValueChange={(value) => setExpanded(value === EXPANDED)}
        >
          <RadioGroupItem
            value={EXPANDED}
            label="Open as it comes"
            className="w-auto"
          />
          <RadioGroupItem
            value={COLLAPSED}
            label="Only the latest line"
            className="w-auto"
          />
        </RadioGroup>
        <p className="mt-1.5 text-sm text-muted-foreground">
          How a model's reasoning shows while it arrives. Only the latest line
          keeps it folded until you open it. It applies to every agent in this
          browser.
        </p>
      </OptionField>
    </section>
  );
}
