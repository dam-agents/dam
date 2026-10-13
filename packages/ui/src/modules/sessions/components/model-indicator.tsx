import type { HarnessCapability } from "agent-runtime-api";

import { HarnessIcons } from "@/components/harness-icons";
import { Button } from "@/components/ui/button";
import { labelVariants } from "@/components/ui/label";
import {
  Popover,
  PopoverClose,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

import { useStore } from "../../../store.js";
import {
  useHarnessCatalog,
  useHarnessConfigured,
  useProviderConnections,
  useProviderModels,
  useRememberedPair,
} from "../api/session-pair.js";
import { harnessDisplayName } from "../lib/session-pair-options.js";
import { SetAsDefault } from "./session-pair-picker.js";
import { SessionPairTrigger } from "./session-pair-trigger.js";
import {
  SessionSettingsControls,
  settingDefaults,
} from "./session-settings-controls.js";

interface Props {
  agentId: string;
  harness: string;
  provider: string | null;
  model: string | null;
  settings?: Readonly<Record<string, string>>;
  carried: readonly HarnessCapability[];
  onChoose: (model: string) => void;
  onConfigure: (settings: Record<string, string>) => void;
  onNewSession: () => void;
}

export function ModelIndicator({
  agentId,
  harness,
  provider,
  model,
  settings = {},
  carried,
  onChoose,
  onConfigure,
  onNewSession,
}: Props) {
  const showConfirm = useStore((s) => s.showConfirm);
  const { data: catalog } = useHarnessCatalog();
  const { data: remembered } = useRememberedPair(agentId);
  const capability = carried.find((h) => h.name === harness);
  const defaults = settingDefaults(
    capability,
    useHarnessConfigured(agentId, harness),
  );
  const { granted, loaded } = useProviderConnections(agentId);
  const activeProvider = granted.find((p) => p.id === provider);
  const removed = loaded && provider !== null && !activeProvider;
  const { data, isLoading, isError, operable } = useProviderModels(
    removed ? null : agentId,
    harness,
    provider,
  );
  const harnessName = harnessDisplayName(harness, catalog?.harnesses);
  const models = removed
    ? []
    : data?.availableModels === null
      ? (carried
          .find((h) => h.name === harness)
          ?.harnessConfigCatalog?.options.find((o) => o.category === "model")
          ?.choices ?? [])
      : (data?.availableModels ?? []);
  const modelName = models.find((m) => m.value === model)?.name ?? model;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <SessionPairTrigger
          testId="session-model-picker"
          label={
            harnessName &&
            [
              modelName,
              harnessName,
              activeProvider?.name,
              removed ? "Provider removed" : null,
            ]
              .filter(Boolean)
              .join(" · ")
          }
        />
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        aria-label="Session harness and model"
        collisionPadding={8}
        className="flex max-h-[var(--radix-popover-content-available-height)] w-[340px] flex-col gap-3 overflow-y-auto text-sm"
      >
        <div className="flex items-center gap-2 px-1">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="flex items-center gap-2 font-medium text-foreground">
              <span className="text-muted-foreground">
                <HarnessIcons harnesses={[harness]} size="xs" />
              </span>
              <span className="truncate">{harnessName ?? harness}</span>
            </div>
            {activeProvider && (
              <h3 className={labelVariants()}>{activeProvider.name}</h3>
            )}
          </div>
          <PopoverClose asChild>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                void showConfirm(
                  <>
                    <p>
                      To use a different harness or model provider, start a new
                      session.
                    </p>
                    <p className="mt-2">
                      If you need to move over context from the current session,
                      ask the agent to save it to a file.
                    </p>
                  </>,
                  "Change harness or provider",
                  { confirmLabel: "New session" },
                ).then((ok) => ok && onNewSession())
              }
            >
              Change
            </Button>
          </PopoverClose>
        </div>
        <section aria-label={activeProvider?.name ?? "Active provider"}>
          <ul
            aria-label="Models for this session"
            className="-mx-1 max-h-56 overflow-y-auto"
          >
            {models.map((choice) => (
              <li key={choice.value}>
                <PopoverClose asChild>
                  <button
                    type="button"
                    aria-current={choice.value === model ? "true" : undefined}
                    onClick={() => onChoose(choice.value)}
                    className="w-full truncate rounded px-1 py-1 text-left text-muted-foreground hover:bg-muted hover:text-foreground aria-[current]:font-medium aria-[current]:text-foreground"
                  >
                    {choice.name}
                  </button>
                </PopoverClose>
              </li>
            ))}
            {models.length === 0 && (
              <li className="px-1 py-1 text-muted-foreground">
                {removed
                  ? "Provider removed."
                  : !operable
                    ? "Start the agent to list models."
                    : isLoading
                      ? "Loading models…"
                      : isError || data?.availableModels === undefined
                        ? "Couldn't load this provider's models."
                        : "No models available."}
              </li>
            )}
          </ul>
        </section>
        {capability?.sessionSettings && (
          <div className="border-t border-border pt-2 empty:hidden">
            <SessionSettingsControls
              capability={capability}
              model={model}
              settings={settings}
              defaults={defaults}
              onChange={(id, value) => onConfigure({ [id]: value })}
            />
          </div>
        )}
        <div className="flex justify-end border-t border-border pt-2 text-xs text-muted-foreground">
          <SetAsDefault
            agentId={agentId}
            pair={{
              harness,
              provider,
              model,
              settings: { ...defaults, ...settings },
            }}
            defaults={defaults}
            remembered={remembered}
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}
