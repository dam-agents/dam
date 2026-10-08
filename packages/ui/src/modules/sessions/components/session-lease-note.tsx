import { Add } from "@carbon/icons-react";

import {
  useGrantProvider,
  useHarnessCatalog,
  useProviderConnections,
} from "../api/session-pair.js";

interface Props {
  agentId: string;
  harness: string;
  provider: string | null;
}

export function SessionLeaseNote({ agentId, harness, provider }: Props) {
  const { data: catalog } = useHarnessCatalog();
  const { granted, owned, loaded } = useProviderConnections(agentId);
  const { grant, pending } = useGrantProvider(agentId);
  const harnessName =
    catalog?.harnesses.find((h) => h.name === harness)?.displayName ?? harness;
  const held = granted.find((p) => p.id === provider);
  const regrantable = owned.find((p) => p.id === provider);
  const removed = loaded && provider !== null && !held;

  return (
    <span className="flex items-center gap-2 text-sm text-muted-foreground">
      <span>
        {harnessName}
        {held && ` · ${held.name}`}
      </span>
      {removed && (
        <span
          data-testid="session-provider-removed"
          className="text-destructive"
        >
          Provider removed
        </span>
      )}
      {removed && regrantable && (
        <button
          type="button"
          disabled={pending}
          aria-label={`Grant ${regrantable.name} to this agent again`}
          onClick={() => void grant(regrantable.id)}
          className="inline-flex items-center gap-1 font-medium text-accent hover:underline disabled:opacity-50"
        >
          <Add size={16} /> {regrantable.name}
        </button>
      )}
    </span>
  );
}
