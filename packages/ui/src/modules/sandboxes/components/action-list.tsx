import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SectionLabel } from "@/components/ui/section-label";
import { cn } from "@/lib/utils";

export interface Action {
  title: string;
  description: ReactNode;
  icon: ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  tooltip?: string;
  testId?: string;
}

// UNIT_BOUNDARY_DESCRIPTION: a labelled card of one-click actions, one per row: what the action does on the left, its button on the right. The danger tone marks the card and every button as destructive.
export function ActionList({
  label,
  actions,
  danger = false,
}: {
  label: string;
  actions: Action[];
  danger?: boolean;
}) {
  return (
    <section className="mb-8">
      <SectionLabel spaced>{label}</SectionLabel>
      <Card
        className={cn("divide-y divide-border", danger && "border-danger/60")}
      >
        {actions.map((a) => (
          <div
            key={a.title}
            className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center"
          >
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-semibold text-foreground">
                {a.title}
              </h3>
              <p className="text-sm text-muted-foreground">{a.description}</p>
            </div>
            <Button
              variant="outline"
              tone={danger ? "danger" : "default"}
              className={cn(
                "shrink-0 self-start sm:self-auto",
                danger && "text-danger",
              )}
              disabled={a.disabled}
              tooltip={a.tooltip}
              onClick={a.onClick}
              data-testid={a.testId}
            >
              {a.icon}
              {a.label}
            </Button>
          </div>
        ))}
      </Card>
    </section>
  );
}
