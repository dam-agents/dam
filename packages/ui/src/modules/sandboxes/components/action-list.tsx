import { ChevronDown, ChevronRight } from "@carbon/icons-react";
import { type ReactNode, useId, useState } from "react";
import { match } from "ts-pattern";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SectionLabel } from "@/components/ui/section-label";
import { cn } from "@/lib/utils";

interface ActionText {
  id?: string;
  icon: ReactNode;
  title: string;
  description: string;
}

export type Action = ActionText &
  (
    | { kind: "link"; onClick: () => void }
    | { kind: "expand"; content: ReactNode }
    | { kind: "control"; control: ReactNode }
    | {
        kind: "button";
        button: {
          label: string;
          onClick: () => void;
          disabled?: boolean;
          danger?: boolean;
          testId?: string;
        };
      }
  );

const ROW =
  "flex w-full flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 text-left";
const CLICKABLE =
  "transition-colors hover:bg-muted/40 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring";

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
        {actions.map((action) =>
          match(action)
            .with({ kind: "link" }, (a) => (
              <button
                key={a.id ?? a.title}
                type="button"
                id={a.id}
                onClick={a.onClick}
                className={cn(ROW, CLICKABLE)}
              >
                <RowText {...a} />
                <RowChevron icon={ChevronRight} />
              </button>
            ))
            .with({ kind: "expand" }, (a) => (
              <ExpandRow key={a.id ?? a.title} {...a} />
            ))
            .with({ kind: "control" }, (a) => (
              <StaticRow key={a.id ?? a.title} {...a}>
                {a.control}
              </StaticRow>
            ))
            .with({ kind: "button" }, (a) => (
              <StaticRow key={a.id ?? a.title} {...a}>
                <Button
                  variant="outline"
                  tone={a.button.danger ? "danger" : "default"}
                  className={cn("shrink-0", a.button.danger && "text-danger")}
                  disabled={a.button.disabled}
                  onClick={a.button.onClick}
                  data-testid={a.button.testId}
                >
                  {a.button.label}
                </Button>
              </StaticRow>
            ))
            .exhaustive(),
        )}
      </Card>
    </section>
  );
}

function RowText({
  icon,
  title,
  description,
  className,
}: ActionText & { className?: string }) {
  return (
    <>
      <span
        aria-hidden
        className="hidden size-5 shrink-0 items-center justify-center self-start pt-0.5 text-muted-foreground sm:flex [&_svg]:size-5"
      >
        {icon}
      </span>
      <span className={cn("min-w-0 flex-1", className)}>
        <span className="block text-sm font-semibold text-foreground">
          {title}
        </span>
        <span className="block text-sm text-muted-foreground">
          {description}
        </span>
      </span>
    </>
  );
}

function RowChevron({
  icon: Icon,
  className,
}: {
  icon: typeof ChevronRight;
  className?: string;
}) {
  return (
    <span className="flex size-10 shrink-0 items-center justify-center text-muted-foreground">
      <Icon size={20} className={className} />
    </span>
  );
}

function ExpandRow({
  id,
  content,
  ...text
}: ActionText & { content: ReactNode }) {
  const [open, setOpen] = useState(false);
  const contentId = useId();
  return (
    <div id={id}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={contentId}
        onClick={() => setOpen(!open)}
        className={cn(ROW, CLICKABLE)}
      >
        <RowText {...text} />
        <RowChevron
          icon={ChevronDown}
          className={cn(
            "transition-transform duration-200 ease-out motion-reduce:transition-none",
            open && "rotate-180",
          )}
        />
      </button>
      {open && (
        <div id={contentId} className="px-4 pb-4 sm:pl-12">
          {content}
        </div>
      )}
    </div>
  );
}

function StaticRow({
  id,
  children,
  ...text
}: ActionText & { children: ReactNode }) {
  return (
    <div id={id} className={cn(ROW, "scroll-mt-24")}>
      <RowText {...text} className="min-w-40" />
      {children}
    </div>
  );
}
