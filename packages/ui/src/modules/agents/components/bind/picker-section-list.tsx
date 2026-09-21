import { SectionLabel } from "@/components/ui/section-label";
import { cn } from "@/lib/utils";

import type { AgentView } from "../../../../types.js";
import { AgentPickerCard } from "./agent-picker-card.js";
import type { PickerSection } from "./picker-sections.js";

interface Props {
  sections: readonly PickerSection[];
  selectedId: string | null;
  scheduleCounts: ReadonlyMap<string, number>;
  onSelect: (agent: AgentView) => void;
}

export function PickerSectionList({
  sections,
  selectedId,
  scheduleCounts,
  onSelect,
}: Props) {
  return (
    <>
      {sections.map((section, index) => (
        <section
          key={section.label}
          className={cn(index === 0 ? "mt-6" : "mt-5")}
        >
          <SectionLabel spaced className="mb-2 text-xs">
            {section.label}
          </SectionLabel>
          <div className="flex flex-col gap-2">
            {section.agents.map((agent) => (
              <AgentPickerCard
                key={agent.id}
                agent={agent}
                selected={agent.id === selectedId}
                activeSchedules={scheduleCounts.get(agent.id) ?? 0}
                onSelect={() => onSelect(agent)}
              />
            ))}
          </div>
        </section>
      ))}
    </>
  );
}
