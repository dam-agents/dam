import { Code, View } from "@carbon/icons-react";

import { Button } from "@/components/ui/button";

interface Props {
  rendered: boolean;
  onToggle: () => void;
  className?: string;
}

export function RenderToggle({ rendered, onToggle, className }: Props) {
  return (
    <Button
      variant="outline"
      size="xs"
      className={className}
      onClick={onToggle}
    >
      {rendered ? <Code size={14} /> : <View size={14} />}
      {rendered ? "Source" : "Preview"}
    </Button>
  );
}
