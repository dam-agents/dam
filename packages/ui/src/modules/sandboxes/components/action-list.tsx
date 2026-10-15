import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SectionLabel } from "@/components/ui/section-label";
import { cn } from "@/lib/utils";

export interface Action {
  id?: string;
  title: string;
  description: ReactNode;
  content?: ReactNode;
  control?: ReactNode;
  button?: {
    icon: ReactNode;
    label: string;
    onClick: () => void;
    disabled?: boolean;
    danger?: boolean;
    testId?: string;
  };
}

// UNIT_BOUNDARY_DESCRIPTION: a card of actions, one per row: what the action does on the left, its button on the right, and any inline content, such as commands to copy, below.
export function ActionList({
  label,
  actions,
}: {
  label?: string;
  actions: Action[];
}) {
  return (
    <section className="mb-8">
      {label && <SectionLabel spaced>{label}</SectionLabel>}
      <Card className="divide-y divide-border">
        {actions.map(({ id, title, description, content, control, button }) => (
          <div
            key={title}
            id={id}
            className="flex scroll-mt-24 flex-col gap-3 px-4 py-3"
          >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-semibold text-foreground">
                  {title}
                </h3>
                <p className="text-sm text-muted-foreground">{description}</p>
              </div>
              {control}
              {button && (
                <Button
                  variant="outline"
                  tone={button.danger ? "danger" : "default"}
                  className={cn(
                    "shrink-0 self-start sm:self-auto",
                    button.danger && "text-danger",
                  )}
                  disabled={button.disabled}
                  onClick={button.onClick}
                  data-testid={button.testId}
                >
                  {button.icon}
                  {button.label}
                </Button>
              )}
            </div>
            {content}
          </div>
        ))}
      </Card>
    </section>
  );
}
