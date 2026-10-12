import type { ProviderKeyProbe } from "../domain/provider-key-probe.js";

// UNIT_BOUNDARY_DESCRIPTION: The e2e stand-in for the provider key probe. The e2e specs save providers with dummy keys such as sk-e2e-dummy-key, which the real model endpoints would refuse, so the probe that would otherwise list the provider's models accepts every key instead. Only the composition root wires it, and only when the e2e control API is on.
export function createAcceptingProviderKeyProbe(): ProviderKeyProbe {
  return {
    probe: async () => ({ ok: true }),
  };
}
