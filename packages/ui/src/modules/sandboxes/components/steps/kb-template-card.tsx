import { CardButton } from "@/components/ui/card-button";

import type { KbTemplate } from "../../../knowledge-bases/lib/kb-templates.js";

interface Props {
  template: KbTemplate;
  selected: boolean;
  onSelect: () => void;
}

export function KbTemplateCard({ template, selected, onSelect }: Props) {
  return (
    <CardButton
      onClick={onSelect}
      selected={selected}
      className="w-full px-4 py-3"
    >
      <p className="text-base font-medium text-foreground leading-[1.2]">
        {template.name}
      </p>
      <p className="text-sm text-muted-foreground">{template.description}</p>
    </CardButton>
  );
}
