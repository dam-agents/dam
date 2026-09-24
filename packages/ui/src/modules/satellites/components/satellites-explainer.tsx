import { ExplainerPopover } from "@/components/explainer-popover";

import { getBrand } from "../../../brand.js";

export function SatellitesExplainer() {
  const cli = getBrand().short;
  return (
    <ExplainerPopover side="bottom" label="What a satellite is">
      <p>
        A satellite is a machine outside the platform that offers tools to your
        agents. It connects out to the platform, so nothing has to reach in.
      </p>
      <p>
        Start one on the machine with <code>{cli} satellite shell</code> or{" "}
        <code>{cli} satellite mcp</code>. Only the agents you add it to can call
        its tools, and the machine checks every call before it runs anything.
      </p>
    </ExplainerPopover>
  );
}
