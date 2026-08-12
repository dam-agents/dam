import { Checkmark } from "@carbon/icons-react";
import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import * as React from "react";

import { cn } from "@/lib/utils";

function Checkbox({
  className,
  ...props
}: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      className={cn(
        "peer flex size-4 shrink-0 items-center justify-center rounded-sm border border-primary ring-offset-background focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground",
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        className={cn("flex items-center justify-center text-current")}
      >
        <Checkmark size={12} />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

interface CheckboxItemProps extends Omit<
  React.ComponentProps<typeof CheckboxPrimitive.Root>,
  "children"
> {
  label: string;
  /** Extra classes for the label text, e.g. `font-mono` for an identifier. */
  labelClassName?: string;
  description?: string;
  /** Extra classes for the description, e.g. `truncate` where a long one would
   *  otherwise turn a picker into a wall of prose. */
  descriptionClassName?: string;
  testId?: string;
}

/** The multi-select counterpart of `RadioGroupItem`. `className` styles the
 *  row, not the box. `aria-label` keeps the description out of the accessible
 *  name, which the wrapping `<label>` would otherwise run together with it. */
function CheckboxItem({
  label,
  labelClassName,
  description,
  descriptionClassName,
  testId,
  className,
  id,
  "aria-describedby": describedBy,
  ...props
}: CheckboxItemProps) {
  const generatedId = React.useId();
  const controlId = id ?? generatedId;
  const descriptionId = `${controlId}-description`;
  return (
    <label
      htmlFor={controlId}
      className={cn(
        "flex w-full cursor-pointer items-start gap-2.5 text-left transition-colors has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50",
        className,
      )}
    >
      <Checkbox
        id={controlId}
        className="mt-0.5"
        aria-label={label}
        aria-describedby={
          [description ? descriptionId : null, describedBy]
            .filter(Boolean)
            .join(" ") || undefined
        }
        data-testid={testId}
        {...props}
      />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span
          className={cn("text-sm font-medium text-foreground", labelClassName)}
        >
          {label}
        </span>
        {description && (
          <span
            id={descriptionId}
            className={cn(
              "text-sm text-muted-foreground",
              descriptionClassName,
            )}
          >
            {description}
          </span>
        )}
      </span>
    </label>
  );
}

export { Checkbox, CheckboxItem };
