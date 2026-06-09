import { OverflowMenuVertical } from "@carbon/icons-react";
import { Check, Loader2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import { useStore } from "../../../store.js";
import {
  useCreateSecret,
  useDeleteSecret,
  useTestAnthropic,
  useUpdateSecret,
} from "../../secrets/api/mutations.js";
import { useSecrets } from "../../secrets/api/queries.js";
import {
  AnthropicIcon,
  LiteLLMIcon,
  OpenAIIcon,
} from "../../settings/components/brand-icons.js";
import { LabeledInput } from "../../v2/components/labeled-input.js";
import {
  findReusableSecret,
  getLlmProvider,
  type LlmProviderId,
} from "../../v2/lib/llm-providers.js";

interface ProviderRowDef {
  key: string;
  label: string;
  description: string;
  icon: React.ReactNode;
  modes: { id: LlmProviderId; label: string }[];
}

function BrandTile({
  bg,
  children,
}: {
  bg: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg",
        bg,
      )}
    >
      {children}
    </div>
  );
}

const PROVIDER_ROWS: readonly ProviderRowDef[] = [
  {
    key: "ibm-litellm",
    label: "IBM LiteLLM ETE Proxy",
    description: "IBM's internal LiteLLM proxy — Claude on watsonx-routed AWS.",
    icon: (
      <BrandTile bg="bg-muted">
        <LiteLLMIcon className="text-[22px] leading-none" />
      </BrandTile>
    ),
    modes: [{ id: "ibm-litellm", label: "Token" }],
  },
  {
    key: "bob",
    label: "Bob Shell",
    description:
      "IBM Bob Shell endpoint with twin-secret credential injection.",
    icon: (
      <BrandTile bg="bg-white">
        <img src="/providers/bob.svg" alt="" className="h-7 w-7" />
      </BrandTile>
    ),
    modes: [{ id: "bob", label: "API key" }],
  },
  {
    key: "anthropic",
    label: "Anthropic",
    description:
      "Claude Code, Claude SDK, and any Anthropic-compatible client.",
    icon: (
      <BrandTile bg="bg-[#D97757]">
        <AnthropicIcon className="h-5 w-5 text-white" />
      </BrandTile>
    ),
    modes: [
      { id: "anthropic-oauth", label: "OAuth token" },
      { id: "anthropic-api", label: "API key" },
    ],
  },
  {
    key: "openai",
    label: "OpenAI",
    description: "GPT-family models for Codex and OpenAI-compatible agents.",
    icon: (
      <BrandTile bg="bg-foreground">
        <OpenAIIcon className="h-5 w-5 text-background" />
      </BrandTile>
    ),
    modes: [{ id: "openai", label: "API key" }],
  },
];

/**
 * One unified provider list. Every provider is shown; the connected one sorts
 * to the top. A connected row offers a settings gear (change / delete the key)
 * and a "Connected → Remove connection" hover affordance. A sandbox uses one
 * provider, so connecting a new one replaces the prior selection.
 */
export function ProviderSection({
  selectedProvider,
  selectedSecretId,
  onSelect,
  onDisconnect,
}: {
  selectedProvider: LlmProviderId | null;
  selectedSecretId: string | null;
  onSelect: (provider: LlmProviderId, secretId: string) => void;
  onDisconnect: () => void;
}) {
  const isConnected = (row: ProviderRowDef) =>
    row.modes.some((m) => m.id === selectedProvider) &&
    Boolean(selectedSecretId);

  const rows = [...PROVIDER_ROWS].sort(
    (a, b) => Number(isConnected(b)) - Number(isConnected(a)),
  );

  return (
    <div className="flex flex-col gap-2">
      <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
        Provider
      </span>
      {rows.map((row) => (
        <ProviderRow
          key={row.key}
          row={row}
          connected={isConnected(row)}
          connectedSecretId={isConnected(row) ? selectedSecretId : null}
          onConnected={onSelect}
          onDisconnect={onDisconnect}
        />
      ))}
    </div>
  );
}

function ProviderRow({
  row,
  connected,
  connectedSecretId,
  onConnected,
  onDisconnect,
}: {
  row: ProviderRowDef;
  connected: boolean;
  connectedSecretId: string | null;
  onConnected: (provider: LlmProviderId, secretId: string) => void;
  onDisconnect: () => void;
}) {
  const { data: secrets = [] } = useSecrets();
  const createSecret = useCreateSecret();
  const updateSecret = useUpdateSecret();
  const deleteSecret = useDeleteSecret();
  const testAnthropic = useTestAnthropic();
  const showConfirm = useStore((s) => s.showConfirm);

  const [expanded, setExpanded] = useState(false);
  const [modeId, setModeId] = useState<LlmProviderId>(row.modes[0]!.id);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Kebab menu (change / delete) + the inline change-key form for a connected
  // provider.
  const [menuOpen, setMenuOpen] = useState(false);
  const [changing, setChanging] = useState(false);
  const [newValue, setNewValue] = useState("");
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node))
        setMenuOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuOpen]);

  const provider = getLlmProvider(modeId);
  const existing = findReusableSecret(provider, secrets);

  const connect = async () => {
    setError(null);
    const sanitized = value.trim();
    if (!sanitized) return setError("Enter a credential.");
    setBusy(true);
    try {
      if (provider.verifyEnvName) {
        const result = await testAnthropic.mutateAsync({
          value: sanitized,
          envName: provider.verifyEnvName,
        });
        if (!result.ok) return setError(result.message);
      }
      const secret = await createSecret.mutateAsync({
        type: provider.secretType,
        name: provider.id,
        value: sanitized,
      });
      onConnected(modeId, secret.id);
      setExpanded(false);
    } catch {
      setError("Could not save the credential.");
    } finally {
      setBusy(false);
    }
  };

  const selectMode = (id: LlmProviderId) => {
    setModeId(id);
    setValue("");
    setError(null);
  };

  const changeKey = async () => {
    if (!connectedSecretId || !newValue.trim()) return;
    await updateSecret.mutateAsync({
      id: connectedSecretId,
      value: newValue.trim(),
    });
    setNewValue("");
    setChanging(false);
  };

  const deleteKey = async () => {
    if (!connectedSecretId) return;
    setMenuOpen(false);
    const confirmed = await showConfirm(
      <>
        Delete this <strong className="text-foreground">{row.label}</strong>{" "}
        key? This permanently deletes the credential <strong>everywhere</strong>{" "}
        — every agent using it loses access. This isn't just removing it from
        this sandbox.
      </>,
      "Delete key",
      { kind: "destructive", confirmLabel: "Delete key" },
    );
    if (!confirmed) return;
    await deleteSecret.mutateAsync({ id: connectedSecretId });
    onDisconnect();
  };

  return (
    <div className="rounded-lg border border-border px-4 py-3">
      <div className="flex items-start gap-3">
        {row.icon}
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-semibold text-foreground">
            {row.label}
          </div>
          <div className="text-[12px] text-muted-foreground">
            {row.description}
          </div>
        </div>
        {connected ? (
          <div className="flex shrink-0 items-center gap-2">
            <RemoveConnectionToggle onRemove={onDisconnect} />
            <div className="relative" ref={menuRef}>
              <button
                type="button"
                aria-label="Manage key"
                title="Manage key"
                onClick={() => setMenuOpen((o) => !o)}
                className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <OverflowMenuVertical size={16} />
              </button>
              {menuOpen && (
                <div className="absolute right-0 top-full z-30 mt-1 w-40 overflow-hidden rounded-lg border border-border bg-card py-1 shadow-sm">
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      setChanging(true);
                    }}
                    className="block w-full px-3 py-2 text-left text-[13px] text-foreground hover:bg-muted"
                  >
                    Change key
                  </button>
                  <button
                    type="button"
                    onClick={deleteKey}
                    className="block w-full px-3 py-2 text-left text-[13px] text-destructive hover:bg-muted"
                  >
                    Delete key
                  </button>
                </div>
              )}
            </div>
          </div>
        ) : (
          !expanded && (
            <button
              type="button"
              onClick={() => {
                // If a key for this provider already exists, connecting is a
                // one-click grant — no need to re-enter or confirm it.
                const key = findReusableSecret(
                  getLlmProvider(row.modes[0]!.id),
                  secrets,
                );
                if (key) onConnected(row.modes[0]!.id, key.id);
                else setExpanded(true);
              }}
              className="shrink-0 text-[13px] font-semibold text-primary hover:underline"
            >
              Connect
            </button>
          )
        )}
      </div>

      {connected && changing && (
        <div className="mt-3 flex items-center gap-2">
          <Input
            type="password"
            placeholder="Paste a new key"
            value={newValue}
            onChange={(e) => setNewValue(e.target.value)}
          />
          <Button
            size="sm"
            onClick={changeKey}
            disabled={updateSecret.isPending || !newValue.trim()}
          >
            {updateSecret.isPending && (
              <Loader2 size={14} className="animate-spin" />
            )}
            Save
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setChanging(false);
              setNewValue("");
            }}
          >
            Cancel
          </Button>
        </div>
      )}

      {expanded && !connected && (
        <div className="mt-3 flex flex-col gap-3">
          {row.modes.length > 1 && (
            <div className="flex gap-1.5">
              {row.modes.map((mode) => (
                <button
                  key={mode.id}
                  type="button"
                  onClick={() => selectMode(mode.id)}
                  className={cn(
                    "rounded-md border px-3 py-1 text-[12px] font-semibold transition-colors",
                    modeId === mode.id
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:text-foreground",
                  )}
                >
                  {mode.label}
                </button>
              ))}
            </div>
          )}
          {existing ? (
            <button
              type="button"
              onClick={() => onConnected(modeId, existing.id)}
              className="self-start text-[12px] text-primary underline hover:text-primary/80"
            >
              Use your saved {provider.label} key
            </button>
          ) : (
            <LabeledInput
              label=""
              type="password"
              placeholder={provider.placeholder}
              value={value}
              onChange={setValue}
              hint={
                provider.verifyEnvName
                  ? "Verified before the key is saved."
                  : undefined
              }
            />
          )}
          {error && (
            <p className="text-[12px] font-medium text-destructive">{error}</p>
          )}
          <div className="flex items-center gap-2">
            <Button onClick={connect} disabled={busy}>
              {busy && <Loader2 size={15} className="animate-spin" />}
              Connect
            </Button>
            <Button
              variant="ghost"
              onClick={() => setExpanded(false)}
              disabled={busy}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/** "Connected" that swaps to "Remove connection" on hover, removing on click. */
function RemoveConnectionToggle({ onRemove }: { onRemove: () => void }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      onClick={onRemove}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className={cn(
        "flex items-center gap-1 text-[13px] font-medium transition-colors",
        hover ? "text-destructive" : "text-success",
      )}
    >
      {hover ? <X size={15} /> : <Check size={15} />}
      {hover ? "Remove connection" : "Connected"}
    </button>
  );
}
