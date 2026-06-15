import { useEffect, useMemo, useState } from "react";

import type { ProviderPresetType, SecretView } from "../../../types.js";
import { useSecrets } from "../../secrets/api/queries.js";
import { useProviderActions } from "../../settings/components/use-provider-actions.js";
import { ProviderConnectDialog } from "./provider-connect-dialog.js";
import { ProviderRow } from "./provider-row.js";

export const PROVIDER_ROWS: {
  type: ProviderPresetType;
  description: string;
}[] = [
  {
    type: "ibm-litellm",
    description: "IBM's internal LiteLLM proxy — Claude on watsonx-routed AWS.",
  },
  {
    type: "bob",
    description:
      "IBM Bob Shell endpoint with twin-secret credential injection.",
  },
  {
    type: "anthropic",
    description:
      "Claude Code, Claude SDK, and any Anthropic-compatible client.",
  },
  {
    type: "openai",
    description: "GPT-family models for Codex and OpenAI-compatible agents.",
  },
];

interface Props {
  /** The currently selected provider secret, or null when none is chosen. */
  selectedSecretId: string | null;
  onSelect: (secretId: string) => void;
  /** Fired after a provider credential is removed, so the parent can clear
   *  its selection if the removed secret was the selected one. */
  onProviderRemoved?: (secretId: string) => void;
  /** Auto-pick the first connected provider while nothing is selected
   *  (wizard onboarding). Off by default: on the settings page an empty
   *  selection is a real state, and auto-picking would fake a dirty edit. */
  autoSelectFirst?: boolean;
}

/**
 * The provider picker shared by the create wizard's Setup step and the
 * sandbox settings page. Single source for `PROVIDER_ROWS`, the connect /
 * edit / remove wiring, and the connect dialog. Provider credentials are
 * key-entry (no OAuth), so there is no redirect to survive here.
 */
export function ProviderSection({
  selectedSecretId,
  onSelect,
  onProviderRemoved,
  autoSelectFirst = false,
}: Props) {
  const { data: secrets = [] } = useSecrets();
  const providerActions = useProviderActions();
  const [dialog, setDialog] = useState<{
    provider: ProviderPresetType;
    secret?: SecretView;
  } | null>(null);

  const secretByType = useMemo(
    () => new Map(secrets.map((s) => [s.type, s])),
    [secrets],
  );

  // Only acts while empty so a just-connected provider isn't nulled out
  // during the secrets refetch.
  useEffect(() => {
    if (!autoSelectFirst || selectedSecretId) return;
    const firstConnected = PROVIDER_ROWS.map((r) =>
      secretByType.get(r.type),
    ).find(Boolean);
    if (firstConnected) onSelect(firstConnected.id);
  }, [autoSelectFirst, selectedSecretId, secretByType, onSelect]);

  return (
    <div className="flex flex-col gap-3">
      {PROVIDER_ROWS.map((row) => {
        const secret = secretByType.get(row.type);
        return (
          <ProviderRow
            key={row.type}
            type={row.type}
            description={row.description}
            secret={secret}
            selected={!!secret && secret.id === selectedSecretId}
            onConnect={() => setDialog({ provider: row.type })}
            onSelect={() => secret && onSelect(secret.id)}
            onEditKey={() =>
              secret && setDialog({ provider: row.type, secret })
            }
            onRemoveKey={() =>
              secret &&
              void providerActions.remove(secret.id, () =>
                onProviderRemoved?.(secret.id),
              )
            }
          />
        );
      })}

      {dialog && (
        <ProviderConnectDialog
          provider={dialog.provider}
          secret={dialog.secret}
          onConnected={(secretId) => {
            onSelect(secretId);
            setDialog(null);
          }}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}
