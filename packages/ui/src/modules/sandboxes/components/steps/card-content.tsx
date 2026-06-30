import { Badge } from "@/components/ui/badge";

import type { TemplateView } from "../../../../types.js";
import { CardTags } from "./card-tags.js";

export function CardContent({ template }: { template: TemplateView }) {
  return (
    <>
      <div className="flex items-baseline justify-between gap-3">
        <div className="flex items-center gap-2">
          <p className="text-[16px] font-semibold text-foreground">
            {template.name}
          </p>
          {template.experimental && (
            <Badge className="shrink-0 border-transparent bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300">
              Alpha
            </Badge>
          )}
        </div>
        <CardTags tags={template.tags} />
      </div>
      {template.description && (
        <p className="text-[14px] text-muted-foreground">
          {template.description}
        </p>
      )}
    </>
  );
}
