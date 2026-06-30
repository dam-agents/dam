import { Box } from "lucide-react";

import type { ProviderPresetType, TemplateView } from "../../../../types.js";
import { CardIcon } from "../../../providers/components/card-icon.js";
import { CardContent } from "./card-content.js";
import { SelectableCard } from "./selectable-card.js";

const HARNESS_PRESET: Record<string, ProviderPresetType> = {
  codex: "openai",
  bob: "bob",
};

const HARNESS_ICON_SRC: Record<string, string> = {
  "claude-code": "/icons/claude-code.svg",
  "pi-agent": "/icons/pi-agent.svg",
};

function HarnessIcon({ templateId }: { templateId: string }) {
  const iconSrc = HARNESS_ICON_SRC[templateId];
  if (iconSrc) {
    return (
      <img
        src={iconSrc}
        alt=""
        width={38}
        height={38}
        className="shrink-0 rounded-lg"
      />
    );
  }
  const preset = HARNESS_PRESET[templateId];
  if (preset) {
    return <CardIcon provider={preset} size="md" />;
  }
  return (
    <div className="flex size-[38px] shrink-0 items-center justify-center rounded-lg bg-muted">
      <Box className="size-5 text-muted-foreground" />
    </div>
  );
}

export function HarnessCard({
  template,
  selected,
  onSelect,
}: {
  template: TemplateView;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <SelectableCard
      selected={selected}
      onSelect={onSelect}
      ariaLabel={template.name}
      testId={`template-card-${template.id}`}
    >
      <div className="flex items-start gap-3">
        <HarnessIcon templateId={template.id} />
        <div className="min-w-0 flex-1">
          <CardContent template={template} />
        </div>
      </div>
    </SelectableCard>
  );
}
