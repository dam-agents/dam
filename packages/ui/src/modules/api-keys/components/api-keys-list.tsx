import type { ApiKeyView } from "api-server-api";
import { KeyRound } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";

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
      <h2 className="text-[18px] font-bold mb-1">API Keys</h2>
      <p className="text-[14px] text-muted-foreground mb-4">
        Long-lived tokens for headless / CI use. Pass the value as a bearer
        credential when calling the API. Plaintext is shown once on creation and
        never recoverable.
      </p>

      <div className="flex justify-end mb-4">
        <Button onClick={() => setCreateOpen(true)}>Create key</Button>
      </div>

      {isLoading && (
        <p className="text-[13px] text-muted-foreground">Loading…</p>
      )}

      {isError && (
        <div className="p-4 rounded-xl border-2 border-danger-light bg-danger-light">
          <p className="text-[13px] text-danger font-semibold mb-1">
            Couldn't load API keys
          </p>
          <p className="text-[12px] text-muted-foreground">
            The server returned an error. Try again or check your network
            connection.
          </p>
        </div>
      )}

      {!isLoading && !isError && keys && keys.length === 0 && (
        <div className="flex flex-col items-center gap-3 p-8 rounded-xl border border-dashed border-border bg-card">
          <KeyRound size={32} className="text-muted-foreground" />
          <p className="text-[13px] text-muted-foreground">
            No API keys yet. Create one to authenticate the CLI without a
            browser.
          </p>
        </div>
      )}

      {!isLoading && !isError && keys && keys.length > 0 && (
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
