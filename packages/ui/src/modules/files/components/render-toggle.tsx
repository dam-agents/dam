import { Code, View } from "@carbon/icons-react";

import { Button } from "@/components/ui/button";

interface Props {
  rendered: boolean;
  onToggle: () => void;
}

export function RenderToggle({ rendered, onToggle }: Props) {
  return (
    <Button variant="outline" size="xs" className="text-sm" onClick={onToggle}>
      {rendered ? <Code size={14} /> : <View size={14} />}
      {rendered ? "Raw" : "Render"}
    </Button>
  );
}
