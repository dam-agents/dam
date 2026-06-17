import { ChevronDown, ChevronUp } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { cn } from "@/lib/utils";

import {
  bobPinsFromEnvMappings,
  type ProviderPresetType,
  type SecretView,
} from "../../../types.js";
import { useSecrets } from "../../secrets/api/queries.js";
import { detectMode, MODES } from "./anthropic/modes.js";
import { ProviderConnectDialog } from "./provider-connect-dialog.js";
import { ProviderRow } from "./provider-row.js";
import { useProviderActions } from "./use-provider-actions.js";

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

function connectedSubtitle(
  type: ProviderPresetType,
  secret: SecretView,
): string | undefined {
  if (type === "anthropic") {
    const mode = detectMode(secret.envMappings?.[0]?.envName);
    return `Set up with ${MODES[mode].label}`;
  }
  if (type === "bob") {
    const pins = bobPinsFromEnvMappings(secret.envMappings);
    return pins.model ? `Model: ${pins.model}` : "Default model";
  }
  return undefined;
}

interface Props {
  selectedSecretId?: string | null;
  onSelect?: (secretId: string) => void;
  onProviderRemoved?: (secretId: string) => void;
  autoSelectFirst?: boolean;
  variant?: "stacked" | "collapsible";
  manage?: boolean;
  listClassName?: string;
}

export function ProviderSection({
  selectedSecretId = null,
  onSelect,
  onProviderRemoved,
  autoSelectFirst = false,
  variant = "stacked",
  manage = false,
  listClassName,
}: Props) {
  const { data: secrets = [], isPending } = useSecrets();
  const providerActions = useProviderActions();
  const [dialog, setDialog] = useState<{
    provider: ProviderPresetType;
    secret?: SecretView;
  } | null>(null);
  const [expanded, setExpanded] = useState(false);

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
    if (firstConnected) onSelect?.(firstConnected.id);
  }, [autoSelectFirst, selectedSecretId, secretByType, onSelect]);

  const renderRow = (row: (typeof PROVIDER_ROWS)[number]) => {
    const secret = secretByType.get(row.type);
    return (
      <ProviderRow
        key={row.type}
        type={row.type}
        description={row.description}
        subtitle={secret ? connectedSubtitle(row.type, secret) : undefined}
        secret={secret}
        selectable={!manage}
        selected={!!secret && secret.id === selectedSecretId}
        onConnect={() => setDialog({ provider: row.type })}
        onSelect={() => secret && onSelect?.(secret.id)}
        onEditKey={() => secret && setDialog({ provider: row.type, secret })}
        onRemoveKey={() =>
          secret &&
          void providerActions.remove(secret.id, () =>
            onProviderRemoved?.(secret.id),
          )
        }
      />
    );
  };

  const connectedRows = PROVIDER_ROWS.filter((r) => secretByType.has(r.type));
  const disconnectedRows = PROVIDER_ROWS.filter(
    (r) => !secretByType.has(r.type),
  );
  // Connected providers stay visible; the rest hide behind "Show all". With
  // nothing connected there's nothing to collapse, so reveal everything.
  const collapsible =
    variant === "collapsible" &&
    connectedRows.length > 0 &&
    disconnectedRows.length > 0;
  const visibleRows =
    variant === "collapsible"
      ? [
          ...connectedRows,
          ...(collapsible && !expanded ? [] : disconnectedRows),
        ]
      : PROVIDER_ROWS;

  return (
    <>
      <div className={cn("flex flex-col gap-3", listClassName)}>
        {isPending
          ? PROVIDER_ROWS.map((row) => <ProviderRow.Skeleton key={row.type} />)
          : visibleRows.map(renderRow)}
      </div>

      {!isPending && collapsible && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-3 inline-flex items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground"
        >
          {expanded ? "Show less" : "Show all"}
          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
      )}

      {dialog && (
        <ProviderConnectDialog
          provider={dialog.provider}
          secret={dialog.secret}
          onConnected={(secretId) => {
            onSelect?.(secretId);
            setDialog(null);
          }}
          onClose={() => setDialog(null)}
        />
      )}
    </>
  );
}
