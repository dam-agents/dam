import type { AgentBackend } from "api-server-api";
import { match } from "ts-pattern";

import type { BackendOffer } from "../../features/lib/backend-offer.js";
import { VM_BACKEND_LABEL } from "../../starter-kits/lib/catalog-cards.js";

// UNIT_BOUNDARY_DESCRIPTION: the Backend a create form shows, and therefore sends. The form sends it explicitly, so what the user saw is what gets created even if the install's default says otherwise. A microVM is the default wherever one is offered; a template that needs a pod (containerOnlyReason, computed by the server) is always a container, and a user may pick a container over the microVM.
export function effectiveBackend(opts: {
  offer: Pick<BackendOffer, "vmOffered">;
  containerOnlyReason: string | undefined;
  picked: AgentBackend | null;
}): AgentBackend {
  if (!opts.offer.vmOffered || opts.containerOnlyReason !== undefined)
    return "container";
  return opts.picked ?? "vm";
}

export function kitBackend(opts: {
  declared: AgentBackend | undefined;
  offer: Pick<BackendOffer, "installDefault">;
  containerOnlyReason: string | undefined;
}): AgentBackend {
  if (opts.declared !== undefined) return opts.declared;
  return opts.offer.installDefault === "vm" &&
    opts.containerOnlyReason === undefined
    ? "vm"
    : "container";
}

export function backendLine(
  backend: AgentBackend,
  containerOnlyReason: string | undefined,
): string {
  return match(backend)
    .with("vm", () => `Runs on the ${VM_BACKEND_LABEL.toLowerCase()}.`)
    .with("container", () =>
      containerOnlyReason === undefined
        ? "Runs as a container."
        : `Runs as a container, because ${containerOnlyReason}.`,
    )
    .exhaustive();
}
