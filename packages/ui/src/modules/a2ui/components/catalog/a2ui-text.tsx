import { useA2uiBindings } from "../../hooks/use-a2ui-bindings.js";
import type { TextComponent } from "../../lib/schema.js";
import { A2uiMarkdown } from "./a2ui-markdown.js";

interface Props {
  component: TextComponent;
}

export function A2uiText({ component }: Props) {
  const text = useA2uiBindings().text(component.text);
  return <A2uiMarkdown text={text} caption={component.variant === "caption"} />;
}
