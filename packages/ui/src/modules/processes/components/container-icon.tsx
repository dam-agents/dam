import { ContainerEngine, ContainerSoftware } from "@carbon/icons-react";
import type { ProcessContainer } from "agent-runtime-api";
import { match } from "ts-pattern";

export function ContainerIcon({ container }: { container: ProcessContainer }) {
  return (
    <span aria-hidden className="flex shrink-0 text-muted-foreground">
      {match(container.role)
        .with("container", () => <ContainerSoftware size={14} />)
        .with("runtime", () => <ContainerEngine size={14} />)
        .exhaustive()}
    </span>
  );
}
