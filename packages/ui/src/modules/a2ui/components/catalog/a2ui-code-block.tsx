import { Markdown } from "@/components/markdown";

import { useA2uiBindings } from "../../hooks/use-a2ui-bindings.js";
import { fencedCode } from "../../lib/fence.js";
import type { CodeBlockComponent } from "../../lib/schema.js";

const LANGUAGE = /^[\w+#.-]*$/;

interface Props {
  component: CodeBlockComponent;
}

export function A2uiCodeBlock({ component }: Props) {
  const code = useA2uiBindings().text(component.code);
  const language = LANGUAGE.test(component.language ?? "")
    ? (component.language ?? "")
    : "";
  return (
    <Markdown className="prose-flush">{fencedCode(code, language)}</Markdown>
  );
}
