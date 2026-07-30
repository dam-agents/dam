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
  size?: "default" | "sm";
  testId?: string;
}

/** The whole row is the radio, so a click anywhere in it selects — callers own
 *  the row's container look through `className`. `aria-label` keeps the
 *  description out of the accessible name, where name-from-content would
 *  otherwise run label and description together. */
function RadioGroupItem({
  label,
  description,
  size = "default",
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
      {/* Fixed px, not rem: the root font-size is 15px, so rem sizes land the
          dot on half device pixels and it reads as off-centre. */}
      <span className="mt-0.5 flex size-[16px] shrink-0 items-center justify-center rounded-full border border-primary">
        <RadioGroupPrimitive.Indicator className="size-[8px] rounded-full bg-primary" />
      </span>
      <span className="flex flex-1 flex-col gap-0.5">
        <span
          className={cn(
            "text-foreground",
            size === "sm"
              ? "text-[13px] font-semibold"
              : "text-[14px] font-medium",
          )}
        >
          {label}
        </span>
        {description && (
          <span
            id={descriptionId}
            className={cn(
              "text-muted-foreground",
              size === "sm" ? "text-[12px]" : "text-[13px]",
            )}
          >
            {description}
          </span>
        )}
      </span>
    </RadioGroupPrimitive.Item>
  );
}

export { RadioGroup, RadioGroupItem };
