import { type CarbonIconType, Document, Network_3 } from "@carbon/icons-react";
import type { KnowledgeBaseTemplateId } from "api-server-api";

import type { KbTemplate } from "../../../knowledge-bases/lib/kb-templates.js";
import { CardIconTile, StackedCard } from "./stacked-card.js";

const KB_TEMPLATE_ICON: Record<KnowledgeBaseTemplateId, CarbonIconType> = {
  "llm-wiki": Network_3,
  "plain-wiki": Document,
};

interface Props {
  template: KbTemplate;
  selected: boolean;
  onSelect: () => void;
}

export function KbTemplateCard({ template, selected, onSelect }: Props) {
  return (
    <StackedCard
      icon={<CardIconTile icon={KB_TEMPLATE_ICON[template.id]} />}
      title={template.name}
      description={template.description}
      selected={selected}
      onSelect={onSelect}
      testId={`kb-template-card-${template.id}`}
    />
  );
}
