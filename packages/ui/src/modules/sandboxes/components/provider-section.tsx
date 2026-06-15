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
   *  its selection if the removed secret was the selected one. Only the
   *  stacked variant exposes a remove action. */
  onProviderRemoved?: (secretId: string) => void;
  /** Auto-pick the first connected provider while nothing is selected
   *  (wizard onboarding). Off by default: on the settings page an empty
   *  selection is a real state, and auto-picking would fake a dirty edit. */
  autoSelectFirst?: boolean;
  /** `"stacked"` (wizard) lists every provider as a card with connect / edit
   *  / remove. `"dropdown"` (settings) is a compact select that expands to
   *  the same list — matching the settings frame. */
  variant?: "stacked" | "dropdown";
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

  // Selecting a connected provider picks it; selecting an unconnected one
  // opens the connect dialog (you can't grant a provider with no credential).
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
        </div>
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
