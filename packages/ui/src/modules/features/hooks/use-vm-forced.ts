import { useInstallCapabilities } from "../api/queries.js";

// UNIT_BOUNDARY_DESCRIPTION: whether this install pins every new agent on the new sandbox runtime, as the api-server's create path decides it; until the install answers it reads as no.
export function useVmForced(): boolean {
  return useInstallCapabilities().data?.vmForced === true;
}
