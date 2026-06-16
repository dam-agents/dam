import { Check, ChevronDown } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import {
  type ProviderPresetType,
  PROVIDERS,
  type SecretView,
} from "../../../types.js";
import { useSecrets } from "../../secrets/api/queries.js";
import { CardIcon } from "../../settings/components/shared/card-icon.js";
import { useProviderActions } from "../../settings/components/use-provider-actions.js";
import { CardList } from "./card-list.js";
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
  selectedSecretId: string | null;
  onSelect: (secretId: string) => void;
  onProviderRemoved?: (secretId: string) => void;
  autoSelectFirst?: boolean;
  variant?: "stacked" | "dropdown";
}

export function ProviderSection({
  selectedSecretId,
  onSelect,
  onProviderRemoved,
  autoSelectFirst = false,
  variant = "stacked",
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

  const pick = (type: ProviderPresetType) => {
    const secret = secretByType.get(type);
    if (secret) onSelect(secret.id);
    else setDialog({ provider: type });
  };

  return (
    <>
      {variant === "dropdown" ? (
        <ProviderDropdown
          secretByType={secretByType}
          selectedSecretId={selectedSecretId}
          onPick={pick}
        />
      ) : (
        <CardList>
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
        </CardList>
      )}

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
    </>
  );
}

function ProviderDropdown({
  secretByType,
  selectedSecretId,
  onPick,
}: {
  secretByType: Map<string, SecretView>;
  selectedSecretId: string | null;
  onPick: (type: ProviderPresetType) => void;
}) {
  const selected = PROVIDER_ROWS.find(
    (r) => secretByType.get(r.type)?.id === selectedSecretId,
  );
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex h-10 w-full items-center gap-3 rounded-md border border-input bg-background px-3 text-sm text-foreground transition-colors hover:bg-muted/30"
        >
          {selected ? (
            <>
              <CardIcon provider={selected.type} size="sm" />
              <span>{PROVIDERS[selected.type].displayName}</span>
            </>
          ) : (
            <span className="text-muted-foreground">Select a provider</span>
          )}
          <ChevronDown size={16} className="ml-auto text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="w-[var(--radix-dropdown-menu-trigger-width)]"
      >
        {PROVIDER_ROWS.map((row) => {
          const secret = secretByType.get(row.type);
          const isSelected = !!secret && secret.id === selectedSecretId;
          return (
            <DropdownMenuItem
              key={row.type}
              onSelect={() => onPick(row.type)}
              className="h-10"
            >
              {isSelected ? (
                <Check size={16} className="shrink-0" />
              ) : (
                <span className="w-4 shrink-0" />
              )}
              <CardIcon provider={row.type} size="sm" />
              <span className="flex-1 truncate">
                {PROVIDERS[row.type].displayName}
              </span>
              {secret && (
                <span className="rounded-full bg-success-light px-2 py-0.5 text-[11px] font-medium text-success">
                  Connected
                </span>
              )}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
