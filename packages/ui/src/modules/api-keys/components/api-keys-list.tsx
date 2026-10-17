import { Add } from "@carbon/icons-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { ListSection } from "@/components/ui/list-section";
import { PageHeader } from "@/components/ui/page-header";

import { useStore } from "../../../store.js";
import { useRevokeApiKey } from "../api/mutations.js";
import { useApiKeys } from "../api/queries.js";
import { ApiKeyRow } from "./api-key-row.js";
import { CreateApiKeyDialog } from "./create-api-key-dialog/index.js";

export function ApiKeysList() {
  const { data: keys, isLoading, isError } = useApiKeys();
  const revokeApiKey = useRevokeApiKey();
  const showConfirm = useStore((s) => s.showConfirm);
  const [createOpen, setCreateOpen] = useState(false);

  async function revoke(id: string, name: string) {
    const ok = await showConfirm(
      <>
        <p className="mb-2">
          The key <span className="font-semibold text-foreground">{name}</span>{" "}
          stops working immediately for every CLI and integration that uses it.
        </p>
        <p>This cannot be undone. To restore access, create a new key.</p>
      </>,
      "Revoke API key?",
      { kind: "destructive", confirmLabel: "Revoke key" },
    );
    if (ok) revokeApiKey.mutate({ id });
  }

  return (
    <div>
      <PageHeader
        title="API keys"
        description="Let the CLI and scripts sign in without a browser. A key is shown only once, when you create it."
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCreateOpen(true)}
          >
            <Add size={16} />
            New API key
          </Button>
        }
      />

      <ListSection
        loading={isLoading}
        error={isError && "Couldn't load API keys."}
        isEmpty={(keys ?? []).length === 0}
        empty="No API keys yet. Create one to authenticate the CLI without a browser."
      >
        {keys?.map((k) => (
          <ApiKeyRow
            key={k.id}
            apiKey={k}
            onRevoke={revoke}
            revoking={
              revokeApiKey.isPending && revokeApiKey.variables?.id === k.id
            }
          />
        ))}
      </ListSection>

      {createOpen && (
        <CreateApiKeyDialog onClose={() => setCreateOpen(false)} />
      )}
    </div>
  );
}
