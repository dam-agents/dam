import type { ClientSideConnection } from "@agentclientprotocol/sdk/dist/acp.js";
import type {
  SessionConfigOption,
  SessionConfigSelectGroup,
  SessionConfigSelectOption,
} from "@agentclientprotocol/sdk/dist/acp.js";
import { Check, ChevronDown, ChevronUp } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { runAction } from "../../../lib/query-helpers.js";
import { useStore } from "../../../store.js";

function prefKey(instanceId: string, key: string) {
  return `platform-pref:${instanceId}:${key}`;
}

function savePreference(instanceId: string, key: string, value: string) {
  try {
    localStorage.setItem(prefKey(instanceId, key), value);
  } catch {}
}

export function getSavedPreferences(instanceId: string): {
  model?: string;
  mode?: string;
  config: Record<string, string>;
} {
  const prefix = `platform-pref:${instanceId}:config:`;
  const config: Record<string, string> = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(prefix)) {
        config[key.slice(prefix.length)] = localStorage.getItem(key)!;
      }
    }
  } catch {}
  return {
    model: localStorage.getItem(prefKey(instanceId, "model")) ?? undefined,
    mode: localStorage.getItem(prefKey(instanceId, "mode")) ?? undefined,
    config,
  };
}

/** Extract short model name from description (e.g. "Sonnet 4.6 · Best for..." → "Sonnet 4.6") */
function shortModelLabel(model: {
  name: string;
  description?: string | null;
}): string {
  if (model.description) {
    const before = model.description.split("·")[0]?.trim();
    if (before && before !== model.name) return before;
  }
  return model.name;
}

/**
 * Inline session config controls: mode label + popover for modes, config options, and model.
 * All dynamically driven from ACP session state — renders nothing if the agent doesn't report capabilities.
 *
 * State management: optimistic UI — updates the store immediately on click,
 * then sends the request to the agent in the background. This avoids the
 * delay/reversal issue where the first ensureConnection() call is slow and
 * a second click races with it.
 */
export function SessionConfigBar({
  ensureConnection,
  engagedSessionIdRef,
  instanceId,
}: {
  ensureConnection: () => Promise<ClientSideConnection | null>;
  engagedSessionIdRef: React.RefObject<string | null>;
  instanceId: string;
}) {
  const modes = useStore((s) => s.sessionModes);
  const models = useStore((s) => s.sessionModels);
  const configOptions = useStore((s) => s.sessionConfigOptions);
  const setSessionModes = useStore((s) => s.setSessionModes);
  const setSessionModels = useStore((s) => s.setSessionModels);
  const setSessionConfigOptions = useStore((s) => s.setSessionConfigOptions);

  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; bottom: number } | null>(null);

  // Position the popover above the trigger button
  const updatePosition = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    setPos({
      left: rect.left,
      bottom: window.innerHeight - rect.top + 4,
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open, updatePosition]);

  // Close popover on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        triggerRef.current?.contains(target) ||
        popoverRef.current?.contains(target)
      )
        return;
      setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const currentMode = modes?.availableModes.find(
    (m) => m.id === modes.currentModeId,
  );
  const hasConfig = !!(modes || models || configOptions.length > 0);
  const [initializing, setInitializing] = useState(false);

  // When the user opens the popover before a session exists, eagerly create
  // one so the config options populate.
  const handleOpen = async () => {
    if (hasConfig) {
      setOpen((o) => !o);
      return;
    }
    // No session yet — create one to get config options
    setInitializing(true);
    await runAction(() => ensureConnection(), "Couldn't load session config");
    setInitializing(false);
    setOpen(true);
  };

  // Optimistic mode change: update store immediately, persist, send in background.
  // Re-applies after ensureConnection since captureSessionConfig may overwrite.
  const setMode = (modeId: string) => {
    if (!modes) return;
    setSessionModes({ ...modes, currentModeId: modeId });
    savePreference(instanceId, "mode", modeId);
    runAction(async () => {
      const conn = await ensureConnection();
      // Re-apply optimistic value — ensureConnection may have overwritten via captureSessionConfig
      const latest = useStore.getState().sessionModes;
      if (latest && latest.currentModeId !== modeId) {
        setSessionModes({ ...latest, currentModeId: modeId });
      }
      const sid = engagedSessionIdRef.current;
      if (conn && sid) await conn.setSessionMode({ sessionId: sid, modeId });
    }, "Couldn't change mode");
  };

  // Optimistic model change
  const setModel = (modelId: string) => {
    if (!models) return;
    setSessionModels({ ...models, currentModelId: modelId });
    savePreference(instanceId, "model", modelId);
    runAction(async () => {
      const conn = await ensureConnection();
      // Re-apply optimistic value — ensureConnection may have overwritten via captureSessionConfig
      const latest = useStore.getState().sessionModels;
      if (latest && latest.currentModelId !== modelId) {
        setSessionModels({ ...latest, currentModelId: modelId });
      }
      const sid = engagedSessionIdRef.current;
      if (conn && sid)
        await conn.unstable_setSessionModel({ sessionId: sid, modelId });
    }, "Couldn't change model");
  };

  // Config option: optimistic, persist, fire-and-forget
  const setConfigOption = (
    opt: SessionConfigOption,
    value: boolean | string,
  ) => {
    const updated = configOptions.map((o) => {
      if (o.id !== opt.id) return o;
      return { ...o, currentValue: value } as SessionConfigOption;
    });
    setSessionConfigOptions(updated);
    savePreference(instanceId, `config:${opt.id}`, String(value));

    runAction(async () => {
      const conn = await ensureConnection();
      const sid = engagedSessionIdRef.current;
      if (!conn || !sid) return;
      const req =
        opt.type === "boolean"
          ? {
              sessionId: sid,
              configId: opt.id,
              type: "boolean" as const,
              value: value as boolean,
            }
          : { sessionId: sid, configId: opt.id, value: value as string };
      const resp = await conn.setSessionConfigOption(req);
      setSessionConfigOptions(resp.configOptions);
    }, `Couldn't apply "${opt.name}"`);
  };

  // Filter config options: exclude "model" and "mode" categories since those
  // have dedicated UI sections above. This prevents mode appearing twice.
  const extraOptions = configOptions.filter(
    (o) => o.category !== "model" && o.category !== "mode",
  );

  const currentModel = models?.availableModels.find(
    (m) => m.modelId === models.currentModelId,
  );

  return (
    <>
      {/* Config summary — single row "Model · Mode" */}
      <button
        ref={triggerRef}
        className="flex items-center gap-1.5 text-[11px] font-semibold text-text-secondary hover:text-accent transition-colors px-2 py-1 rounded-md hover:bg-accent-light disabled:opacity-50"
        onClick={handleOpen}
        disabled={initializing}
      >
        {initializing ? (
          <span className="text-text-muted">Loading...</span>
        ) : (
          <span className="truncate max-w-[250px]">
            {[currentModel && shortModelLabel(currentModel), currentMode?.name]
              .filter(Boolean)
              .join(" · ") || "Config"}
          </span>
        )}
        {!initializing &&
          (open ? (
            <ChevronDown size={12} className="shrink-0" />
          ) : (
            <ChevronUp size={12} className="shrink-0" />
          ))}
      </button>

      {/* Popover — portaled to body to escape stacking context */}
      {open &&
        hasConfig &&
        pos &&
        createPortal(
          <div
            ref={popoverRef}
            className="fixed w-[300px] max-h-[400px] overflow-y-auto rounded-xl border-2 border-border bg-surface z-[9999] anim-scale-in shadow-brutal"
            style={{
              left: pos.left,
              bottom: pos.bottom,
            }}
          >
            {/* Model selector */}
            {models && (
              <div className="border-b border-border-light">
                <div className="px-4 pt-3 pb-1 text-[10px] font-bold uppercase tracking-[0.05em] text-text-muted">
                  Model
                </div>
                {models.availableModels.map((m) => {
                  const active = m.modelId === models.currentModelId;
                  return (
                    <button
                      key={m.modelId}
                      className={`flex items-center gap-2 w-full px-4 py-2 text-[13px] text-left transition-colors ${active ? "text-accent bg-accent-light font-semibold" : "text-text hover:bg-surface-raised"}`}
                      onClick={() => setModel(m.modelId)}
                    >
                      {active && <Check size={12} className="shrink-0" />}
                      <div className={active ? "" : "ml-[20px]"}>
                        <div>{m.name}</div>
                        <div className="text-[11px] text-text-muted font-normal font-mono">
                          {m.modelId}
                        </div>
                        {m.description && (
                          <div className="text-[11px] text-text-muted font-normal">
                            {m.description}
                          </div>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}

            {/* Mode selector */}
            {modes && modes.availableModes.length > 1 && (
              <div className="border-b border-border-light">
                <div className="px-4 pt-3 pb-1 text-[10px] font-bold uppercase tracking-[0.05em] text-text-muted">
                  Mode
                </div>
                {modes.availableModes.map((m) => (
                  <button
                    key={m.id}
                    className={`flex items-center gap-2 w-full px-4 py-2 text-[13px] text-left transition-colors ${m.id === modes.currentModeId ? "text-accent bg-accent-light font-semibold" : "text-text hover:bg-surface-raised"}`}
                    onClick={() => setMode(m.id)}
                  >
                    {m.id === modes.currentModeId && (
                      <Check size={12} className="shrink-0" />
                    )}
                    <div
                      className={
                        m.id === modes.currentModeId ? "" : "ml-[20px]"
                      }
                    >
                      <div>{m.name}</div>
                      {m.description && (
                        <div className="text-[11px] text-text-muted">
                          {m.description}
                        </div>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}

            {/* Config options (excluding model and mode categories) */}
            {extraOptions.length > 0 && (
              <div>
                <div className="px-4 pt-3 pb-1 text-[10px] font-bold uppercase tracking-[0.05em] text-text-muted">
                  Options
                </div>
                {extraOptions.map((opt) => (
                  <ConfigOptionRow
                    key={opt.id}
                    option={opt}
                    onChange={(v) => setConfigOption(opt, v)}
                  />
                ))}
              </div>
            )}

            {/* Empty state */}
            {!models &&
              (!modes || modes.availableModes.length <= 1) &&
              extraOptions.length === 0 && (
                <div className="px-4 py-4 text-[12px] text-text-muted">
                  No configuration options available
                </div>
              )}
          </div>,
          document.body,
        )}
    </>
  );
}

function ConfigOptionRow({
  option,
  onChange,
}: {
  option: SessionConfigOption;
  onChange: (v: boolean | string) => void;
}) {
  if (option.type === "boolean") {
    return (
      <label className="flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-surface-raised transition-colors">
        <input
          type="checkbox"
          checked={option.currentValue}
          onChange={(e) => onChange(e.target.checked)}
          className="accent-[var(--color-accent)] w-4 h-4"
        />
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-medium text-text">{option.name}</div>
          {option.description && (
            <div className="text-[11px] text-text-muted">
              {option.description}
            </div>
          )}
        </div>
      </label>
    );
  }

  // Select type — narrowed from discriminated union after boolean check above
  const selectOpt = option as Extract<SessionConfigOption, { type: "select" }>;
  const flatOptions = flattenSelectOptions(selectOpt.options);
  return (
    <div className="px-4 py-2.5">
      <div className="text-[13px] font-medium text-text mb-1">
        {option.name}
      </div>
      {option.description && (
        <div className="text-[11px] text-text-muted mb-2">
          {option.description}
        </div>
      )}
      <div className="flex flex-wrap gap-1">
        {flatOptions.map((o) => (
          <button
            key={o.value}
            className={`text-[11px] font-bold uppercase tracking-[0.03em] border-2 rounded-full px-2.5 py-0.5 transition-colors ${o.value === selectOpt.currentValue ? "bg-accent text-white border-accent-hover" : "bg-surface text-text-muted border-border-light hover:border-accent hover:text-accent"}`}
            onClick={() => onChange(o.value)}
          >
            {o.name}
          </button>
        ))}
      </div>
    </div>
  );
}

function flattenSelectOptions(
  options: Array<SessionConfigSelectOption> | Array<SessionConfigSelectGroup>,
): SessionConfigSelectOption[] {
  if (!options || options.length === 0) return [];
  // Check if grouped
  if ("group" in options[0]) {
    return (options as SessionConfigSelectGroup[]).flatMap((g) => g.options);
  }
  return options as SessionConfigSelectOption[];
}
