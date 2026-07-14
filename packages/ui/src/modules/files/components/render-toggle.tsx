import { Code, View as Eye } from "@carbon/icons-react";

import { Button } from "@/components/ui/button";

interface Props {
  /** True when the rendered view is showing; false shows the raw source. */
  rendered: boolean;
  onToggle: () => void;
  /** Tooltip shown while rendered (i.e. the action switches to raw). */
  rawTitle: string;
  /** Tooltip shown while raw (i.e. the action switches to rendered). */
  renderTitle: string;
}

/** Toolbar button that flips a previewable file between its rendered view and
 * raw source. Shared by the SVG, markdown, and HTML file-viewer previews. */
export function RenderToggle({
  rendered,
  onToggle,
  rawTitle,
  renderTitle,
}: Props) {
  return (
    <Button
      variant="outline"
      size="xs"
      className="text-[14px]"
      onClick={onToggle}
      title={rendered ? rawTitle : renderTitle}
    >
      {rendered ? <Code size={14} /> : <Eye size={14} />}
      {rendered ? "Raw" : "Render"}
    </Button>
  );
}
