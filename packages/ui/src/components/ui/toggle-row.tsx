import { type ReactNode, useId } from "react";

import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

type ToggleRowProps = {
  title: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
  label?: string;
  className?: string;
} & (
  | { control: ReactNode }
  | {
      control?: never;
      checked: boolean;
      onCheckedChange: (on: boolean) => void;
    }
);

/**
 * UNIT_BOUNDARY_DESCRIPTION: one setting on one row: its title, the muted line that says what it does, and the control that changes it, which a click anywhere on the row toggles. The switch takes the title as its accessible name and points at the description, so a screen reader reads every setting the same way. A caller whose control is not a switch passes it, and the row stops being a label, so a click on the text changes nothing.
 */
export function ToggleRow(props: ToggleRowProps) {
  const { title, description, disabled, label, className } = props;
  const descriptionId = useId();
  const toggleable = !("control" in props) && !disabled;
  const Tag = "control" in props ? "div" : "label";

  return (
    <Tag
      className={cn(
        "flex items-start justify-between gap-4",
        toggleable && "cursor-pointer",
        className,
      )}
    >
      <span className="min-w-0">
        <span className="block text-sm font-medium text-foreground">
          {title}
        </span>
        {description && (
          <span
            id={descriptionId}
            className="mt-0.5 block text-sm text-muted-foreground"
          >
            {description}
          </span>
        )}
      </span>
      {"control" in props ? (
        props.control
      ) : (
        <Switch
          checked={props.checked}
          onCheckedChange={props.onCheckedChange}
          disabled={disabled}
          label={label ?? (typeof title === "string" ? title : undefined)}
          describedBy={description ? descriptionId : undefined}
        />
      )}
    </Tag>
  );
}
