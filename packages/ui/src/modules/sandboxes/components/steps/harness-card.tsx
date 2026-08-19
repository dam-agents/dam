import { Box } from "@carbon/icons-react";

import { Badge } from "@/components/ui/badge";

import type { ProviderPresetType, TemplateView } from "../../../../types.js";
import { CardIcon } from "../../../providers/components/card-icon.js";
import { CardTags } from "./card-tags.js";
import { CardIconTile, StackedCard } from "./stacked-card.js";

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
  return <CardIconTile icon={Box} />;
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
    <StackedCard
      icon={<HarnessIcon templateId={template.id} />}
      title={template.name}
      description={template.description}
      badge={
        template.experimental ? (
          <Badge variant="warning" className="shrink-0">
            Alpha
          </Badge>
        ) : undefined
      }
      trailing={<CardTags tags={template.tags} />}
      selected={selected}
      onSelect={onSelect}
      testId={`template-card-${template.id}`}
    />
  );
}
