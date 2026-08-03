import { Code, View } from "@carbon/icons-react";

import { Button } from "@/components/ui/button";

interface Props {
  /** True when the rendered view is showing; false shows the raw source. */
  rendered: boolean;
  onToggle: () => void;
}

/** Toolbar button that flips a previewable file between its rendered view and
 * raw source. Shared by the SVG, markdown, and HTML file-viewer previews. */
export function RenderToggle({ rendered, onToggle }: Props) {
  return (
    <Button variant="outline" size="xs" className="text-sm" onClick={onToggle}>
      {rendered ? <Code size={14} /> : <View size={14} />}
      {rendered ? "Raw" : "Render"}
    </Button>
  );
}
