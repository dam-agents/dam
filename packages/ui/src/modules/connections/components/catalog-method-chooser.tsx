import { ArrowRight } from "@carbon/icons-react";
import type { ConnectionTemplateView } from "api-server-api";

import { CardButton } from "@/components/ui/card-button";

import { templateMethodCopy } from "../lib/catalog-providers.js";

interface Props {
  templates: ConnectionTemplateView[];
  onPick: (template: ConnectionTemplateView) => void;
}

export function CatalogMethodChooser({ templates, onPick }: Props) {
  return (
    <div className="flex flex-col gap-4">
      {templates.map((template) => (
        <MethodCard
          key={template.id}
          template={template}
          onPick={() => onPick(template)}
        />
      ))}
    </div>
  );
}

function MethodCard({
  template,
  onPick,
}: {
  template: ConnectionTemplateView;
  onPick: () => void;
}) {
  const { title, description } = templateMethodCopy(template);
  return (
    <CardButton
      onClick={onPick}
      data-testid={`catalog-method-${template.id}`}
      className="flex items-center gap-4 p-4"
    >
      <div className="min-w-0 flex-1">
        <p className="text-[15px] font-medium text-foreground">{title}</p>
        {description && (
          <p className="mt-1 text-[14px] text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      <ArrowRight size={16} className="shrink-0 text-muted-foreground" />
    </CardButton>
  );
}
