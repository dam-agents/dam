import { type ConnectionView, providerTypeForTemplateId } from "api-server-api";
import { ChevronDown, ChevronUp } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { cn } from "@/lib/utils";

import {
  bobPinsFromEnvMappings,
  type ProviderPresetType,
  type SecretView,
} from "../../../types.js";
import { useAppConnections } from "../../connections/api/queries.js";
import { useSecrets } from "../../secrets/api/queries.js";
import { detectMode, MODES } from "./anthropic/modes.js";
import { ProviderConnectDialog } from "./provider-connect-dialog.js";
import {
  bobPinsFromConnection,
  type ProviderItem,
  type ProviderRef,
  providerRef,
  sameProviderRef,
} from "./provider-item.js";
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

function secretSubtitle(
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

function connectionSubtitle(
  type: ProviderPresetType,
  conn: ConnectionView,
): string | undefined {
  if (type === "anthropic") {
    const label =
      conn.templateId === "anthropic-oauth"
        ? MODES.oauth.label
        : MODES["api-key"].label;
    return `Set up with ${label}`;
  }
  if (type === "bob") {
    const model = bobPinsFromConnection(conn).model;
    return model ? `Model: ${model}` : "Default model";
  }
  return undefined;
}

function itemSubtitle(
  type: ProviderPresetType,
  item: ProviderItem,
): string | undefined {
  return item.source === "connection"
    ? connectionSubtitle(type, item.conn)
    : secretSubtitle(type, item.secret);
}

interface Props {
  selected?: ProviderRef | null;
  onSelect?: (ref: ProviderRef) => void;
  onProviderRemoved?: (ref: ProviderRef) => void;
  autoSelectFirst?: boolean;
  variant?: "stacked" | "collapsible";
  manage?: boolean;
  listClassName?: string;
}

export function ProviderSection({
  selected = null,
  onSelect,
  onProviderRemoved,
  autoSelectFirst = false,
  variant = "stacked",
  manage = false,
  listClassName,
}: Props) {
  const { data: connections = [] } = useAppConnections();
  const { data: secrets = [], isPending } = useSecrets();
  const providerActions = useProviderActions();
  const [dialog, setDialog] = useState<{
    provider: ProviderPresetType;
    item?: ProviderItem;
  } | null>(null);
  const [expanded, setExpanded] = useState(false);

  // Prefer a provider connection; fall back to a legacy provider secret so
  // existing agents keep showing their provider until #1273 migrates them.
  const itemByType = useMemo(() => {
    const connByType = new Map<ProviderPresetType, ConnectionView>();
    for (const c of connections) {
      const preset = providerTypeForTemplateId(c.templateId);
      if (preset && !connByType.has(preset)) connByType.set(preset, c);
    }
    const secretByType = new Map(secrets.map((s) => [s.type, s]));
    const m = new Map<ProviderPresetType, ProviderItem>();
    for (const row of PROVIDER_ROWS) {
      const conn = connByType.get(row.type);
      if (conn) {
        m.set(row.type, { source: "connection", id: conn.id, conn });
        continue;
      }
      const secret = secretByType.get(row.type);
      if (secret) m.set(row.type, { source: "secret", id: secret.id, secret });
    }
    return m;
  }, [connections, secrets]);

  // Only acts while empty so a just-connected provider isn't nulled out during
  // the list refetch.
  useEffect(() => {
    if (!autoSelectFirst || selected) return;
    const first = PROVIDER_ROWS.map((r) => itemByType.get(r.type)).find(
      Boolean,
    );
    if (first) onSelect?.(providerRef(first));
  }, [autoSelectFirst, selected, itemByType, onSelect]);

  const renderRow = (row: (typeof PROVIDER_ROWS)[number]) => {
    const item = itemByType.get(row.type);
    const ref = item ? providerRef(item) : null;
    return (
      <ProviderRow
        key={row.type}
        type={row.type}
        description={row.description}
        subtitle={item ? itemSubtitle(row.type, item) : undefined}
        connected={!!item}
        selectable={!manage}
        selected={!!ref && !!selected && sameProviderRef(ref, selected)}
        onConnect={() => setDialog({ provider: row.type })}
        onSelect={() => ref && onSelect?.(ref)}
        onEditKey={() => item && setDialog({ provider: row.type, item })}
        onRemoveKey={() =>
          item &&
          void providerActions.remove(providerRef(item), () =>
            onProviderRemoved?.(providerRef(item)),
          )
        }
      />
    );
  };

  const connectedRows = PROVIDER_ROWS.filter((r) => itemByType.has(r.type));
  const disconnectedRows = PROVIDER_ROWS.filter((r) => !itemByType.has(r.type));
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
          item={dialog.item}
          onConnected={(ref) => {
            onSelect?.(ref);
            setDialog(null);
          }}
          onClose={() => setDialog(null)}
        />
      )}
    </>
  );
}
