import { useInstallCapabilities } from "../api/queries.js";

// UNIT_BOUNDARY_DESCRIPTION: whether this install pins every new agent on the new sandbox runtime, as the api-server's create path decides it. Undefined until the install answers, so a view can wait rather than show the wrong runtime and then change; a read that failed settles as no.
export function useVmForced(): boolean | undefined {
  const install = useInstallCapabilities();
  if (install.isError) return false;
  return install.data === undefined
    ? undefined
    : install.data.vmForced === true;
}
