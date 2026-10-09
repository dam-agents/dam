import { Add, TrashCan } from "@carbon/icons-react";

import { Button } from "@/components/ui/button";
import { Inset } from "@/components/ui/inset";
import { SectionLabel } from "@/components/ui/section-label";

import { useStore } from "../../../store.js";
import {
  useGrantProvider,
  useProviderConnections,
} from "../../sessions/api/session-pair.js";

export function ProviderGrantsSection({ agentId }: { agentId: string }) {
  const { granted, owned } = useProviderConnections(agentId);
  const { grant, revoke, pending } = useGrantProvider(agentId);
  const showConfirm = useStore((s) => s.showConfirm);
  const confirmRemove = (id: string, name: string) =>
    showConfirm(
      <p>
        Sessions running on <strong>{name}</strong> stop until it is granted
        again. Schedules and channels that use it move to another provider.
      </p>,
      `Remove ${name} from this agent?`,
      { confirmLabel: "Remove provider" },
    ).then((ok) => {
      if (ok) void revoke(id);
    });
  const grantedIds = new Set(granted.map((p) => p.id));
  const addable = owned.filter((p) => !grantedIds.has(p.id));

  return (
    <section className="mb-8" data-testid="provider-grants">
      <SectionLabel spaced>Model providers</SectionLabel>
      <Inset>
        <ul className="flex flex-col gap-1">
          {granted.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-2">
              <span className="text-sm">{p.name}</span>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label={`Remove ${p.name}`}
                disabled={pending}
                onClick={() => void confirmRemove(p.id, p.name)}
              >
                <TrashCan size={16} />
              </Button>
            </li>
          ))}
          {granted.length === 0 && (
            <li className="text-sm text-muted-foreground">
              No model provider granted.
            </li>
          )}
        </ul>
        {addable.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-3">
            {addable.map((p) => (
              <button
                key={p.id}
                type="button"
                disabled={pending}
                aria-label={`Grant ${p.name} to this agent`}
                onClick={() => void grant(p.id)}
                className="inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline disabled:opacity-50"
              >
                <Add size={16} /> {p.name}
              </button>
            ))}
          </div>
        )}
      </Inset>
      <p className="mt-3 text-xs text-muted-foreground">
        Each session picks its model from these. Removing one stops the sessions
        that run on it until it is granted again.
      </p>
    </section>
  );
}
