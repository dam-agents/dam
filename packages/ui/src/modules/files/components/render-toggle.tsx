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
      variant="ghost"
      size="sm"
      className={`h-auto px-2 py-0.5 text-[11px] font-semibold ${rendered ? "text-primary bg-primary/10" : "text-muted-foreground hover:text-foreground/80"}`}
      onClick={onToggle}
      title={rendered ? rawTitle : renderTitle}
    >
      {rendered ? <Code size={11} /> : <Eye size={11} />}
      {rendered ? "Raw" : "Render"}
    </Button>
  );
}
