import { externalLinkProps } from "@/lib/external-link";

import type { TemplateView } from "../../../../types.js";
import { CardContent } from "./card-content.js";
import { SelectableCard } from "./selectable-card.js";

export function WorkloadCard({
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
      <div className="flex min-w-0 flex-col gap-1">
        <CardContent template={template} />
        {template.docsUrl && (
          <a
            href={template.docsUrl}
            {...externalLinkProps}
            className="pointer-events-auto inline-block w-fit text-sm text-muted-foreground underline underline-offset-2 hover:text-primary"
          >
            Learn more
          </a>
        )}
      </div>
    </SelectableCard>
  );
}
