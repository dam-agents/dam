import { ChevronDown, ChevronRight } from "@carbon/icons-react";
import { type ReactNode, useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SectionLabel } from "@/components/ui/section-label";
import { cn } from "@/lib/utils";

export interface Action {
  id?: string;
  icon: ReactNode;
  title: string;
  description: string;
  onClick?: () => void;
  content?: ReactNode;
  control?: ReactNode;
  button?: {
    label: string;
    onClick: () => void;
    disabled?: boolean;
    danger?: boolean;
    testId?: string;
  };
}

const ROW = "flex w-full items-center gap-3 px-4 py-3 text-left";
const CLICKABLE =
  "transition-colors hover:bg-muted/40 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring";

// UNIT_BOUNDARY_DESCRIPTION: a card of actions, one per row: what the action does on the left, how to take it on the right. A row that goes somewhere is one link with a chevron; a row with inline content, such as commands to copy, expands as a whole; other rows carry their own buttons.
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
      <Card className="divide-y divide-border overflow-hidden">
        {actions.map((action) => (
          <ActionRow key={action.id ?? action.title} {...action} />
        ))}
      </Card>
    </section>
  );
}

function ActionRow({
  id,
  icon,
  title,
  description,
  onClick,
  content,
  control,
  button,
}: Action) {
  const [open, setOpen] = useState(false);
  const contentId = useId();
  const text = (
    <>
      <span
        aria-hidden
        className="hidden size-5 shrink-0 items-center justify-center self-start pt-0.5 text-muted-foreground sm:flex [&_svg]:size-5"
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-foreground">
          {title}
        </span>
        <span className="block text-sm text-muted-foreground">
          {description}
        </span>
      </span>
    </>
  );
  const chevron = (Icon: typeof ChevronRight, className?: string) => (
    <span className="flex size-10 shrink-0 items-center justify-center text-muted-foreground">
      <Icon size={20} className={className} />
    </span>
  );

  if (onClick)
    return (
      <button
        type="button"
        id={id}
        onClick={onClick}
        className={cn(ROW, CLICKABLE)}
      >
        {text}
        {chevron(ChevronRight)}
      </button>
    );
  if (content)
    return (
      <div id={id}>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={contentId}
          onClick={() => setOpen(!open)}
          className={cn(ROW, CLICKABLE)}
        >
          {text}
          {chevron(
            ChevronDown,
            cn("transition-transform", open && "rotate-180"),
          )}
        </button>
        {open && (
          <div id={contentId} className="px-4 pb-4 sm:pl-12">
            {content}
          </div>
        )}
      </div>
    );
  return (
    <div id={id} className={cn(ROW, "scroll-mt-24 flex-wrap sm:flex-nowrap")}>
      {text}
      {control}
      {button && (
        <Button
          variant="outline"
          tone={button.danger ? "danger" : "default"}
          className={cn("shrink-0", button.danger && "text-danger")}
          disabled={button.disabled}
          onClick={button.onClick}
          data-testid={button.testId}
        >
          {button.label}
        </Button>
      )}
    </div>
  );
}
