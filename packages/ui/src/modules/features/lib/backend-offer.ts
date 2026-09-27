import type { AgentBackend } from "api-server-api";
import { match } from "ts-pattern";

export interface Answer<T> {
  value: T | undefined;
  failed: boolean;
}

export interface InstallBackends {
  virtualization: boolean;
  defaultBackend: AgentBackend;
}

export interface BackendOffer {
  answered: boolean;
  vmOffered: boolean;
  installDefault: AgentBackend;
}

const NO_VM: BackendOffer = {
  answered: true,
  vmOffered: false,
  installDefault: "container",
};
const UNANSWERED: BackendOffer = { ...NO_VM, answered: false };

// UNIT_BOUNDARY_DESCRIPTION: whether a create form may offer the new sandbox runtime, from two answers. The install says whether it can run a microVM and which Backend it gives a create that names none. When that default is vm the runtime is the install's own, so the user's vm-sandboxes flag is not asked at all; when it is container, the flag is how a user opts in before the operator does. An answer that has not arrived reads as unanswered, so a form waits instead of creating what its author did not choose. A read that failed is an answer: it settles as no microVM, because a form that can never be submitted is worse than a container the user is shown.
export function backendOffer(
  install: Answer<InstallBackends>,
  vmFlag: Answer<boolean>,
): BackendOffer {
  if (install.failed) return NO_VM;
  if (install.value === undefined) return UNANSWERED;
  if (!install.value.virtualization) return NO_VM;
  return match(install.value.defaultBackend)
    .with("vm", () => ({
      answered: true,
      vmOffered: true,
      installDefault: "vm" as const,
    }))
    .with("container", () => {
      if (vmFlag.failed) return NO_VM;
      if (vmFlag.value === undefined) return UNANSWERED;
      return { ...NO_VM, vmOffered: vmFlag.value };
    })
    .exhaustive();
}
