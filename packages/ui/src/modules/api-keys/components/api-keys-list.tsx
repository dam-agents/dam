import type { ApiKeyView } from "api-server-api";
import { useState } from "react";

import { Callout } from "@/components/ui/callout";
import { ListSection } from "@/components/ui/list-section";
import { PageHeader } from "@/components/ui/page-header";

import { useRevokeApiKey } from "../api/mutations.js";
import { useApiKeys } from "../api/queries.js";
import { ApiKeyRow } from "./api-key-row.js";
import { ConfirmRevokeDialog } from "./confirm-revoke-dialog.js";
import { CreateApiKeyDialog } from "./create-api-key-dialog/index.js";

type RevokeTarget = Pick<ApiKeyView, "id" | "name">;

export function ApiKeysList() {
  const { data: keys, isLoading, isError } = useApiKeys();
  const revokeApiKey = useRevokeApiKey();
  const [createOpen, setCreateOpen] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<RevokeTarget | null>(null);

  function handleConfirmRevoke() {
    if (!revokeTarget) return;
    revokeApiKey.mutate(
      { id: revokeTarget.id },
      { onSettled: () => setRevokeTarget(null) },
    );
  }

  return (
    <div className="anim-in w-full max-w-2xl">
      <PageHeader
        title="API keys"
        description="Long-lived tokens for headless / CI use. Pass the value as a bearer credential when calling the API. Plaintext is shown once on creation and never recoverable."
      />

      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}

      {isError && (
        <Callout tone="danger">
          <p className="text-sm text-danger font-semibold mb-1">
            Couldn't load API keys
          </p>
          <p className="text-xs text-muted-foreground">
            The server returned an error. Try again or check your network
            connection.
          </p>
        </Callout>
      )}

      {!isLoading && !isError && keys && (
        <ListSection
          onNew={() => setCreateOpen(true)}
          isEmpty={keys.length === 0}
          empty="No API keys yet. Create one to authenticate the CLI without a browser."
        >
          {keys.map((k) => (
            <ApiKeyRow
              key={k.id}
              apiKey={k}
              onRevoke={(id, name) => setRevokeTarget({ id, name })}
              revoking={revokeApiKey.isPending && revokeTarget?.id === k.id}
            />
          ))}
        </ListSection>
      )}

      {createOpen && (
        <CreateApiKeyDialog onClose={() => setCreateOpen(false)} />
      )}

      {revokeTarget && (
        <ConfirmRevokeDialog
          apiKey={revokeTarget}
          onConfirm={handleConfirmRevoke}
          onCancel={() => setRevokeTarget(null)}
          pending={revokeApiKey.isPending}
        />
      )}
    </div>
  );
}
