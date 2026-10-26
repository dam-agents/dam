import type { ApiKeyView } from "api-server-api";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { PageEmptyState } from "@/components/ui/page-empty-state";
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
    <div className="anim-in">
      <PageHeader
        title="API Keys"
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

      {!isLoading && !isError && keys && keys.length === 0 && (
        <PageEmptyState
          title="No API keys yet"
          message="Create one to authenticate the CLI without a browser."
          actionLabel="Create key"
          onAction={() => setCreateOpen(true)}
        />
      )}

      {!isLoading && !isError && keys && keys.length > 0 && (
        <>
          <Button className="mb-4" onClick={() => setCreateOpen(true)}>
            Create key
          </Button>
          <ul className="space-y-2">
            {keys.map((k) => (
              <ApiKeyRow
                key={k.id}
                apiKey={k}
                onRevoke={(id, name) => setRevokeTarget({ id, name })}
                revoking={revokeApiKey.isPending && revokeTarget?.id === k.id}
              />
            ))}
          </ul>
        </>
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
