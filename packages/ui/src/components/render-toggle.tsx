import { Code, View } from "@carbon/icons-react";

import { Button } from "@/components/ui/button";

interface Props {
  rendered: boolean;
  onToggle: () => void;
  className?: string;
  labelClassName?: string;
}

export function RenderToggle({
  rendered,
  onToggle,
  className,
  labelClassName,
}: Props) {
  const label = rendered ? "Source" : "Preview";
  return (
    <Button
      variant="outline"
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
