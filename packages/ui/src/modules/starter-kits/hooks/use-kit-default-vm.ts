import { useVmForced } from "../../features/hooks/use-vm-forced.js";
import { useVmRuntime } from "../../features/hooks/use-vm-runtime.js";

// UNIT_BOUNDARY_DESCRIPTION: whether a kit that declares no backend is created on the new sandbox runtime, as the api-server's apply decides it: the install pins every create on it, or the owner opted into it on an install that can run one. Undefined until both answers have arrived, so the kit card and the kit page show neither the VM badge nor a size rather than flip once they do.
export function useKitDefaultVm(): boolean | undefined {
  const forced = useVmForced();
  const runtime = useVmRuntime();
  return forced === true || (runtime.answered ? runtime.vm : undefined);
}
