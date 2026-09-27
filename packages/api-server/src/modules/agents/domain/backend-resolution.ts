import type { AgentBackend } from "api-server-api";
import { match } from "ts-pattern";

export type BackendResolution =
  | { kind: "resolved"; backend: AgentBackend }
  | { kind: "refused"; reason: string };

// UNIT_BOUNDARY_DESCRIPTION: which Backend a new Agent gets. The create input's `vm` is three answers: true and false are the caller's own choice, and absent means "whatever this install creates by default". An explicit choice always wins over the install default, because the caller saw what it asked for. The one limit is eligibility: an agent whose template needs a pod (containerOnlyReason) gets a container when it asked for nothing, even on an install that defaults to vm, and an explicit request for vm is refused with that reason rather than creating a machine the CRD or the controller would reject later. Whether the install can run a machine at all is checked by the caller, which owns the error for it.
export function resolveBackend(opts: {
  requestedVm: boolean | undefined;
  installDefault: AgentBackend;
  containerOnlyReason: string | undefined;
}): BackendResolution {
  const reason = opts.containerOnlyReason;
  if (opts.requestedVm === false) return resolved("container");
  if (opts.requestedVm === true)
    return reason === undefined ? resolved("vm") : { kind: "refused", reason };
  return match(opts.installDefault)
    .with("container", () => resolved("container"))
    .with("vm", () => resolved(reason === undefined ? "vm" : "container"))
    .exhaustive();
}

function resolved(backend: AgentBackend): BackendResolution {
  return { kind: "resolved", backend };
}
