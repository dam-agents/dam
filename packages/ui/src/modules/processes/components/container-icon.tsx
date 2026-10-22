import { ContainerEngine, ContainerSoftware } from "@carbon/icons-react";
import type { ProcessContainer } from "agent-runtime-api";
import { match } from "ts-pattern";

import { containerLabel } from "../lib/process-copy.js";

export function ContainerIcon({ container }: { container: ProcessContainer }) {
  const label = containerLabel(container);
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className="flex shrink-0 text-muted-foreground"
    >
      {match(container.role)
        .with("container", () => <ContainerSoftware size={14} />)
        .with("runtime", () => <ContainerEngine size={14} />)
        .exhaustive()}
    </span>
  );
}
