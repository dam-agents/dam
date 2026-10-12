import { Box } from "@carbon/icons-react";
import type { HarnessFamily } from "api-server-api";

import { HarnessIcons } from "@/components/harness-icons";
import { Badge } from "@/components/ui/badge";
import { cardSelectionVariants } from "@/components/ui/card";
import { cn } from "@/lib/utils";

import type { TemplateView } from "../../../../types.js";

const TEMPLATE_HARNESS: Record<string, HarnessFamily> = {
  "claude-code": "claude-code",
  codex: "codex",
  "pi-agent": "pi",
  bob: "bob",
};

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
    <div
      className={cn(
        cardSelectionVariants({ selected }),
        "relative p-4",
        selected ? undefined : "bg-gradient-to-br from-muted/60 to-transparent",
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        aria-label={template.name}
        data-testid={`template-card-${template.id}`}
        className="absolute inset-0 rounded-lg focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      />
      <div className="pointer-events-none relative">
        <div className="flex min-h-[96px] flex-col gap-3">
          <div className="flex items-start justify-between gap-3">
            {template.id === "default" ? (
              <HarnessIcons />
            ) : TEMPLATE_HARNESS[template.id] ? (
              <HarnessIcons harnesses={[TEMPLATE_HARNESS[template.id]]} />
            ) : (
              <div className="flex size-[38px] shrink-0 items-center justify-center rounded-lg border border-border bg-card">
                <Box className="size-5 text-muted-foreground" />
              </div>
            )}
            {template.tags && template.tags.length > 0 ? (
              <span className="shrink-0 text-sm text-muted-foreground">
                {template.tags.join(" · ")}
              </span>
            ) : null}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="text-base font-semibold text-foreground">
                {template.name}
              </p>
              {template.experimental ? (
                <Badge variant="warning" className="shrink-0">
                  Alpha
                </Badge>
              ) : undefined}
            </div>
            {template.description && (
              <p className="text-sm text-muted-foreground">
                {template.description}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
