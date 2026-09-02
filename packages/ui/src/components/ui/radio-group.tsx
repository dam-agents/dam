import * as RadioGroupPrimitive from "@radix-ui/react-radio-group";
import * as React from "react";

import { cn } from "@/lib/utils";

function RadioGroup({
  className,
  ...props
}: React.ComponentProps<typeof RadioGroupPrimitive.Root>) {
  return (
    <RadioGroupPrimitive.Root
      className={cn("flex flex-col gap-2", className)}
      {...props}
    />
  );
}

interface RadioGroupItemProps extends Omit<
  React.ComponentProps<typeof RadioGroupPrimitive.Item>,
  "children"
> {
  label: string;
  description?: string;
  testId?: string;
}

function RadioGroupItem({
  label,
  description,
  testId,
  className,
  "aria-describedby": describedBy,
  ...props
}: RadioGroupItemProps) {
  const descriptionId = React.useId();
  return (
    <RadioGroupPrimitive.Item
      aria-label={label}
      aria-describedby={
        [description ? descriptionId : null, describedBy]
          .filter(Boolean)
          .join(" ") || undefined
      }
      data-testid={testId}
      className={cn(
        "flex w-full items-start gap-2.5 text-left ring-offset-background transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border border-primary">
        <RadioGroupPrimitive.Indicator className="size-2 rounded-full bg-primary" />
      </span>
      <span className="flex flex-1 flex-col gap-0.5">
        <span className="text-sm font-medium text-foreground">{label}</span>
        {description && (
          <span id={descriptionId} className="text-sm text-muted-foreground">
            {description}
          </span>
        )}
      </span>
    </RadioGroupPrimitive.Item>
  );
}

interface RadioGroupCardProps extends Omit<
  React.ComponentProps<typeof RadioGroupPrimitive.Item>,
  "children"
> {
  label: string;
  description?: string;
  testId?: string;
  children?: React.ReactNode;
}

function RadioGroupCard({
  label,
  description,
  testId,
  className,
  children,
  ...props
}: RadioGroupCardProps) {
  const descriptionId = React.useId();
  return (
    <div className={cn("rounded-lg border border-border", className)}>
      <RadioGroupPrimitive.Item
        aria-label={label}
        aria-describedby={description ? descriptionId : undefined}
        data-testid={testId}
        className="flex w-full items-start gap-3 p-4 text-left ring-offset-background transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        {...props}
      >
        <span className="flex flex-1 flex-col gap-0.5">
          <span className="text-[15px] font-medium text-foreground">
            {label}
          </span>
          {description && (
            <span id={descriptionId} className="text-sm text-muted-foreground">
              {description}
            </span>
          )}
        </span>
        <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border border-primary">
          <RadioGroupPrimitive.Indicator className="size-2 rounded-full bg-primary" />
        </span>
      </RadioGroupPrimitive.Item>
      {children != null && (
        <div className="border-t border-border p-4">{children}</div>
      )}
    </div>
  );
}

export { RadioGroup, RadioGroupCard, RadioGroupItem };
