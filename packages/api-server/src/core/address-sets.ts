export interface AddressSet {
  uiBaseUrl: string;
  keycloakExternalUrl: string;
  shareBaseUrl: string;
  contentBaseUrl: string;
}

export interface AddressSets {
  public: AddressSet;
  all: readonly AddressSet[];
  forHost(host: string | undefined): AddressSet;
}

function hostnames(set: AddressSet): string[] {
  return [
    set.uiBaseUrl,
    set.keycloakExternalUrl,
    set.shareBaseUrl,
    set.contentBaseUrl,
  ].map((u) => new URL(u).hostname.toLowerCase());
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: The addresses an install answers on: its public
 * set, and the backchannel set the agent that installed it in an Environment
 * reaches through the Environment Link, when the install has one. A request
 * is served on the set its `Host` names, by host name alone, so the two sets
 * share no host name; a host neither set names is served on the public set.
 */
export function createAddressSets(
  publicSet: AddressSet,
  backchannel: AddressSet | null,
): AddressSets {
  const all = backchannel ? [publicSet, backchannel] : [publicSet];
  const byHostname = new Map<string, AddressSet>();
  for (const set of all) {
    for (const hostname of new Set(hostnames(set))) {
      if (byHostname.has(hostname))
        throw new Error(
          `The backchannel addresses must not use a host name of the public ones: ${hostname}`,
        );
      byHostname.set(hostname, set);
    }
  }
  return {
    public: publicSet,
    all,
    forHost(host) {
      const hostname = host?.split(":")[0]?.toLowerCase();
      return (hostname && byHostname.get(hostname)) || publicSet;
    },
  };
}

export function keycloakRealmUrl(
  set: Pick<AddressSet, "keycloakExternalUrl">,
  realm: string,
): string {
  return `${set.keycloakExternalUrl}/realms/${realm}`;
}
