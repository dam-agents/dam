import { Card } from "@/components/ui/card";

import type { CardComponent } from "../../lib/schema.js";
import { A2uiNode } from "../a2ui-node.js";

interface Props {
  component: CardComponent;
  depth: number;
}

export function A2uiCard({ component, depth }: Props) {
  return (
    <Card className="flex flex-col gap-4 p-5">
      <A2uiNode id={component.child} depth={depth + 1} />
    </Card>
  );
}
