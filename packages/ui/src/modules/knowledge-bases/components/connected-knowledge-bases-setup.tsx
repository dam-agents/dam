import { SHARED_KB_TEMPLATE_ID } from "api-server-api";

import { Button } from "@/components/ui/button";
import { SectionLabel } from "@/components/ui/section-label";

import { useAppConnections } from "../../connections/api/queries.js";
import { useConnectKnowledgeBase } from "../hooks/use-connect-knowledge-base.js";
import { KbLinkForm } from "./kb-link-form.js";

interface Props {
  connectionIds: string[];
  onToggle: (id: string, granted: boolean) => void;
}

export function ConnectedKnowledgeBasesSetup({
  connectionIds,
  onToggle,
}: Props) {
  const connectionsQ = useAppConnections({ fresh: true });
  const form = useConnectKnowledgeBase();

  const staged = new Set(connectionIds);
  const connected = (connectionsQ.data ?? []).filter(
    (c) => c.templateId === SHARED_KB_TEMPLATE_ID && staged.has(c.id),
  );

  return (
    <section className="mb-8">
      <SectionLabel spaced>Knowledge bases</SectionLabel>
      <div className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">
          Paste share links to give this agent read-only access to other
          knowledge bases. Add as many as you like.
        </p>

        <KbLinkForm
          link={form.link}
          setLink={form.setLink}
          error={form.error}
          formatOk={form.formatOk}
          trimmed={form.trimmed}
          busy={form.busy}
          onConnect={() => form.connect((id) => onToggle(id, true))}
        />

        {connectionsQ.isError ? (
          <p className="text-xs text-warning">
            Couldn't load the knowledge bases already added — they stay selected
            and reappear once the list loads.
          </p>
        ) : connectionsQ.isPending && connectionIds.length > 0 ? (
          <p className="text-xs text-muted-foreground">
            Loading the knowledge bases already added…
          </p>
        ) : null}

        {connected.length > 0 && (
          <div className="flex flex-col gap-2">
            {connected.map((connection) => {
              const unreachable = connection.status === "expired";
              return (
                <div
                  key={connection.id}
                  className={`flex items-center justify-between gap-3 rounded-lg border p-3 ${
                    unreachable ? "border-warning/50" : "border-border"
                  }`}
                >
                  <div className="flex flex-col gap-0.5">
                    <span className="text-sm font-medium text-foreground">
                      {connection.name}
                    </span>
                    {unreachable && (
                      <span className="text-xs text-warning">
                        Link rotated or revoked — paste the owner's current link
                        above to reconnect.
                      </span>
                    )}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    onClick={() => onToggle(connection.id, false)}
                  >
                    Remove
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
