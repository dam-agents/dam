import { A2uiScopeProvider } from "../../contexts/a2ui-scope-context.js";
import { useA2uiScope } from "../../contexts/a2ui-scope-context.js";
import { useA2uiBindings } from "../../hooks/use-a2ui-bindings.js";
import { MAX_TEMPLATE_ITEMS } from "../../lib/limits.js";
import type { ChildList } from "../../lib/schema.js";
import { A2uiNode } from "../a2ui-node.js";

interface Props {
  childList: ChildList;
  depth: number;
}

export function A2uiChildren({ childList, depth }: Props) {
  const bindings = useA2uiBindings();
  const scope = useA2uiScope();
  if (Array.isArray(childList))
    return childList.map((id) => (
      <A2uiNode key={id} id={id} depth={depth + 1} />
    ));
  const items = bindings.read(childList.path);
  if (!Array.isArray(items)) return null;
  const listPath = bindings.absolute(childList.path);
  return items.slice(0, MAX_TEMPLATE_ITEMS).map((_, index) => (
    <A2uiScopeProvider
      key={index}
      value={{
        path: `${listPath}/${index}`,
        indexes: [...scope.indexes, index],
      }}
    >
      <A2uiNode id={childList.componentId} depth={depth + 1} />
    </A2uiScopeProvider>
  ));
}
