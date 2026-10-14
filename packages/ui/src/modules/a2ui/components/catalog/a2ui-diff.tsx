import { Markdown } from "@/components/markdown";

import { useA2uiBindings } from "../../hooks/use-a2ui-bindings.js";
import { fencedCode } from "../../lib/fence.js";
import type { DiffComponent } from "../../lib/schema.js";

interface Props {
  component: DiffComponent;
}

export function A2uiDiff({ component }: Props) {
  const bindings = useA2uiBindings();
  const title = bindings.text(component.title);
  return (
    <div className="flex flex-col gap-1.5">
      {title && (
        <p className="font-mono text-xs text-muted-foreground">{title}</p>
      )}
      <Markdown className="prose-flush">
        {fencedCode(bindings.text(component.diff), "diff")}
      </Markdown>
    </div>
  );
}
