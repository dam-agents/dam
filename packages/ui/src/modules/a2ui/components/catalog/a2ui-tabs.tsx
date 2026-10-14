import { useState } from "react";

import { Tabs } from "@/components/ui/tabs";

import { useA2uiBindings } from "../../hooks/use-a2ui-bindings.js";
import type { TabsComponent } from "../../lib/schema.js";
import { A2uiNode } from "../a2ui-node.js";

interface Props {
  component: TabsComponent;
  depth: number;
}

export function A2uiTabs({ component, depth }: Props) {
  const bindings = useA2uiBindings();
  const [active, setActive] = useState("0");
  const tabs = component.tabs.map((tab, index) => ({
    value: String(index),
    label: bindings.text(tab.title),
  }));
  const child = component.tabs[Number(active)]?.child;
  return (
    <div className="flex flex-col gap-3">
      <Tabs
        tabs={tabs}
        value={active}
        onValueChange={setActive}
        size="sm"
        ariaLabel={tabs.map((tab) => tab.label).join(", ")}
      />
      {child !== undefined && <A2uiNode id={child} depth={depth + 1} />}
    </div>
  );
}
