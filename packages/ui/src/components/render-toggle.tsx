import { Code, View } from "@carbon/icons-react";
import type { ComponentProps } from "react";

import { Button } from "@/components/ui/button";

interface Props {
  rendered: boolean;
  onToggle: () => void;
  className?: string;
  labelClassName?: string;
  variant?: ComponentProps<typeof Button>["variant"];
}

export function RenderToggle({
  rendered,
  onToggle,
  className,
  labelClassName,
  variant = "outline",
}: Props) {
  const label = rendered ? "Source" : "Preview";
  return (
    <Button
      variant={variant}
      size="xs"
      className={className}
      onClick={onToggle}
      aria-label={label}
      tooltip={label}
    >
      {rendered ? <Code size={14} /> : <View size={14} />}
      <span className={labelClassName}>{label}</span>
    </Button>
  );
}
