import type { AgentBackend } from "api-server-api";

import { Inset } from "@/components/ui/inset";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { SectionLabel } from "@/components/ui/section-label";

import { VM_BACKEND_LABEL } from "../../starter-kits/lib/catalog-cards.js";
import { backendLine } from "../lib/create-backend.js";

const VM_DESCRIPTION =
  "A microVM of its own. Starts faster, and can run containers (Docker, Kubernetes) inside.";
const CONTAINER_DESCRIPTION = "A pod on the cluster, the current runtime.";

export function BackendSection({
  backend,
  containerOnlyReason,
  onPick,
}: {
  backend: AgentBackend;
  containerOnlyReason?: string;
  onPick?: (backend: AgentBackend) => void;
}) {
  return (
    <section className="mb-8">
      <SectionLabel spaced>Runtime</SectionLabel>
      <Inset>
        {onPick && containerOnlyReason === undefined ? (
          <RadioGroup
            value={backend}
            onValueChange={(value) =>
              onPick(value === "container" ? "container" : "vm")
            }
          >
            <RadioGroupItem
              value="vm"
              label={VM_BACKEND_LABEL}
              description={VM_DESCRIPTION}
            />
            <RadioGroupItem
              value="container"
              label="Container"
              description={CONTAINER_DESCRIPTION}
            />
          </RadioGroup>
        ) : (
          <p className="text-sm text-muted-foreground">
            {backendLine(backend, containerOnlyReason)}
          </p>
        )}
      </Inset>
    </section>
  );
}
