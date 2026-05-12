import type { ClientSideConnection } from "@agentclientprotocol/sdk/dist/acp.js";
import type {
  SessionConfigOption,
  SessionConfigSelectGroup,
  SessionConfigSelectOption,
} from "@agentclientprotocol/sdk/dist/acp.js";
import {
  Checkmark as Check,
  ChevronDown,
  ChevronUp,
} from "@carbon/icons-react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

import { runAction } from "../../../lib/query-helpers.js";
import { useStore } from "../../../store.js";

function prefKey(instanceId: string, key: string) {
  return `platform-pref:${instanceId}:${key}`;
}

function savePreference(instanceId: string, key: string, value: string) {
  try { localStorage.setItem(prefKey(instanceId, key), value); } catch {}
}

export function getSavedPreferences(instanceId: string): { model?: string; mode?: string; config: Record<string, string> } {
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
function shortModelLabel(model: { name: string; description?: string | null }): string {
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
  const modes = useStore(s => s.sessionModes);
  const models = useStore(s => s.sessionModels);
  const configOptions = useStore(s => s.sessionConfigOptions);
  const setSessionModes = useStore(s => s.setSessionModes);
  const setSessionModels = useStore(s => s.setSessionModels);
  const setSessionConfigOptions = useStore(s => s.setSessionConfigOptions);

  const [open, setOpen] = useState(false);
  const [initializing, setInitializing] = useState(false);

  const currentMode = modes?.availableModes.find(m => m.id === modes.currentModeId);
  const hasConfig = !!(modes || models || configOptions.length > 0);

  // When the user opens the popover before a session exists, eagerly create
  // one so the config options populate.
  const handleOpenChange = async (next: boolean) => {
    if (!next) {
      setOpen(false);
      return;
    }
    if (hasConfig) {
      setOpen(true);
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
      if (conn && sid) await conn.unstable_setSessionModel({ sessionId: sid, modelId });
    }, "Couldn't change model");
  };

  // Config option: optimistic, persist, fire-and-forget
  const setConfigOption = (opt: SessionConfigOption, value: boolean | string) => {
    const updated = configOptions.map(o => {
      if (o.id !== opt.id) return o;
      return { ...o, currentValue: value } as SessionConfigOption;
    });
    setSessionConfigOptions(updated);
    savePreference(instanceId, `config:${opt.id}`, String(value));

    runAction(async () => {
      const conn = await ensureConnection();
      const sid = engagedSessionIdRef.current;
      if (!conn || !sid) return;
      const req = opt.type === "boolean"
        ? { sessionId: sid, configId: opt.id, type: "boolean" as const, value: value as boolean }
        : { sessionId: sid, configId: opt.id, value: value as string };
      const resp = await conn.setSessionConfigOption(req);
      setSessionConfigOptions(resp.configOptions);
    }, `Couldn't apply "${opt.name}"`);
  };

  // Filter config options: exclude "model" and "mode" categories since those
  // have dedicated UI sections above. This prevents mode appearing twice.
  const extraOptions = configOptions.filter(o => o.category !== "model" && o.category !== "mode");

  const currentModel = models?.availableModels.find(m => m.modelId === models.currentModelId);

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          disabled={initializing}
          className="flex items-center gap-1.5 text-[11px] font-semibold text-foreground/80 hover:text-primary hover:bg-primary/10 px-2 py-1 h-auto"
        >
          {initializing ? (
            <span className="text-muted-foreground">Loading...</span>
          ) : (
            <span className="truncate max-w-[250px]">
              {[currentModel && shortModelLabel(currentModel), currentMode?.name].filter(Boolean).join(" · ") || "Config"}
            </span>
          )}
          {!initializing && (open ? <ChevronDown size={12} className="shrink-0" /> : <ChevronUp size={12} className="shrink-0" />)}
        </Button>
      </PopoverTrigger>
      {hasConfig && (
        <PopoverContent
          side="top"
          align="start"
          className="w-[300px] max-h-[400px] overflow-y-auto rounded-xl border-2 border-input bg-card p-0"
        >
          {/* Model selector */}
          {models && (
            <div className="border-b border-border">
              <div className="px-4 pt-3 pb-1 text-[10px] font-bold uppercase tracking-[0.05em] text-muted-foreground">Model</div>
              {models.availableModels.map(m => {
                const active = m.modelId === models.currentModelId;
                return (
                  <Button
                    key={m.modelId}
                    variant="ghost"
                    className={`flex items-start gap-2 w-full justify-start rounded-none h-auto px-4 py-2 text-[13px] text-left ${active ? "text-primary bg-primary/10 font-semibold" : "text-foreground hover:bg-muted"}`}
                    onClick={() => setModel(m.modelId)}
                  >
                    {active && <Check size={12} className="shrink-0 mt-1" />}
                    <div className={active ? "" : "ml-[20px]"}>
                      <div>{m.name}</div>
                      <div className="text-[11px] text-muted-foreground font-normal font-mono">{m.modelId}</div>
                      {m.description && <div className="text-[11px] text-muted-foreground font-normal">{m.description}</div>}
                    </div>
                  </Button>
                );
              })}
            </div>
          )}

          {/* Mode selector */}
          {modes && modes.availableModes.length > 1 && (
            <div className="border-b border-border">
              <div className="px-4 pt-3 pb-1 text-[10px] font-bold uppercase tracking-[0.05em] text-muted-foreground">Mode</div>
              {modes.availableModes.map(m => (
                <Button
                  key={m.id}
                  variant="ghost"
                  className={`flex items-start gap-2 w-full justify-start rounded-none h-auto px-4 py-2 text-[13px] text-left ${m.id === modes.currentModeId ? "text-primary bg-primary/10 font-semibold" : "text-foreground hover:bg-muted"}`}
                  onClick={() => setMode(m.id)}
                >
                  {m.id === modes.currentModeId && <Check size={12} className="shrink-0 mt-1" />}
                  <div className={m.id === modes.currentModeId ? "" : "ml-[20px]"}>
                    <div>{m.name}</div>
                    {m.description && <div className="text-[11px] text-muted-foreground">{m.description}</div>}
                  </div>
                </Button>
              ))}
            </div>
          )}

          {/* Config options (excluding model and mode categories) */}
          {extraOptions.length > 0 && (
            <div>
              <div className="px-4 pt-3 pb-1 text-[10px] font-bold uppercase tracking-[0.05em] text-muted-foreground">Options</div>
              {extraOptions.map(opt => (
                <ConfigOptionRow key={opt.id} option={opt} onChange={(v) => setConfigOption(opt, v)} />
              ))}
            </div>
          )}

          {/* Empty state */}
          {!models && (!modes || modes.availableModes.length <= 1) && extraOptions.length === 0 && (
            <div className="px-4 py-4 text-[12px] text-muted-foreground">No configuration options available</div>
          )}
        </PopoverContent>
      )}
    </Popover>
  );
}

function ConfigOptionRow({ option, onChange }: { option: SessionConfigOption; onChange: (v: boolean | string) => void }) {
  if (option.type === "boolean") {
    return (
      <label className="flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-muted transition-colors">
        <Checkbox
          checked={option.currentValue}
          onCheckedChange={(v) => onChange(!!v)}
        />
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-medium text-foreground">{option.name}</div>
          {option.description && <div className="text-[11px] text-muted-foreground">{option.description}</div>}
        </div>
      </label>
    );
  }

  // Select type — narrowed from discriminated union after boolean check above
  const selectOpt = option as Extract<SessionConfigOption, { type: "select" }>;
  const flatOptions = flattenSelectOptions(selectOpt.options);
  return (
    <div className="px-4 py-2.5">
      <div className="text-[13px] font-medium text-foreground mb-1">{option.name}</div>
      {option.description && <div className="text-[11px] text-muted-foreground mb-2">{option.description}</div>}
      <div className="flex flex-wrap gap-1">
        {flatOptions.map(o => (
          <Badge
            key={o.value}
            variant={o.value === selectOpt.currentValue ? "default" : "outline"}
            className={`cursor-pointer text-[11px] font-bold uppercase tracking-[0.03em] border-2 rounded-full px-2.5 py-0.5 ${o.value === selectOpt.currentValue ? "bg-primary text-primary-foreground border-primary hover:bg-primary/90" : "bg-card text-muted-foreground border-border hover:border-primary hover:text-primary"}`}
            onClick={() => onChange(o.value)}
          >
            {o.name}
          </Badge>
        ))}
      </div>
    </div>
  );
}

function flattenSelectOptions(options: Array<SessionConfigSelectOption> | Array<SessionConfigSelectGroup>): SessionConfigSelectOption[] {
  if (!options || options.length === 0) return [];
  // Check if grouped
  if ("group" in options[0]) {
    return (options as SessionConfigSelectGroup[]).flatMap(g => g.options);
  }
  return options as SessionConfigSelectOption[];
}
