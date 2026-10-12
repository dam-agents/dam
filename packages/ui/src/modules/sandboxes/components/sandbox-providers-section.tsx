import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";

import { useStore } from "../../../store.js";
import { CardIcon } from "../../providers/components/card-icon.js";
import {
  useGrantProvider,
  useProviderConnections,
} from "../../sessions/api/session-pair.js";

export function SandboxProvidersSection({ agentId }: { agentId: string }) {
  const navigateToSettings = useStore((s) => s.navigateToSettings);
  const showConfirm = useStore((s) => s.showConfirm);
  const { owned, granted, loaded } = useProviderConnections(agentId);
  const { grant, revoke, pending } = useGrantProvider(agentId);

  return (
    <div className="flex flex-col gap-3">
      {loaded && owned.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No providers connected yet.
        </p>
      )}
      {owned.map((p) => {
        const attached = granted.some((g) => g.id === p.id);
        return (
          <Card key={p.id} className="flex items-center gap-3 p-4">
            <CardIcon provider={p.type} />
            <span className="min-w-0 flex-1 truncate text-base font-medium text-foreground">
              {p.name}
            </span>
            <Switch
              checked={attached}
              disabled={pending}
              label={`Use ${p.name} in this agent`}
              onCheckedChange={(on) =>
                on
                  ? void grant(p.id)
                  : void showConfirm(
                      <p>
                        Sessions running on <strong>{p.name}</strong> stop until
                        it is attached again. Schedules and channels that use it
                        move to another provider.
                      </p>,
                      `Disconnect ${p.name} from this agent?`,
                      { kind: "destructive", confirmLabel: "Disconnect" },
                    ).then((ok) => ok && revoke(p.id))
              }
            />
          </Card>
        );
      })}
      <Button
        variant="outline"
        className="self-start"
        onClick={() => navigateToSettings("providers")}
      >
        Manage providers
      </Button>
    </div>
  );
}
