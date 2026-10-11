import type { HarnessCapability } from "agent-runtime-api";

import {
  Popover,
  PopoverClose,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

import {
  useHarnessCatalog,
  useProviderConnections,
  useProviderModels,
  useRememberedPair,
} from "../api/session-pair.js";
import { SetAsDefault } from "./session-pair-picker.js";
import { SessionSettingsControls } from "./session-settings-controls.js";

interface Props {
  agentId: string;
  harness: string;
  provider: string | null;
  model: string | null;
  settings?: Readonly<Record<string, string>>;
  carried: readonly HarnessCapability[];
  onChoose: (model: string) => void;
  onConfigure: (settings: Record<string, string | null>) => void;
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
  const { data: catalog } = useHarnessCatalog();
  const { data: remembered } = useRememberedPair(agentId);
  const capability = carried.find((h) => h.name === harness);
  const { granted, loaded } = useProviderConnections(agentId);
  const activeProvider = granted.find((p) => p.id === provider);
  const removed = loaded && provider !== null && !activeProvider;
  const { data, isLoading, isError, operable } = useProviderModels(
    removed ? null : agentId,
    harness,
    provider,
  );
  const harnessName =
    catalog?.harnesses.find((h) => h.name === harness)?.displayName ?? harness;
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
        <button
          type="button"
          data-testid="session-model-picker"
          className="flex items-center gap-1 pl-3 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          {[
            modelName,
            harnessName,
            activeProvider?.name,
            removed ? "Provider removed" : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        aria-label="Session harness and model"
        collisionPadding={8}
        className="flex max-h-[var(--radix-popover-content-available-height)] w-[340px] flex-col gap-3 overflow-y-auto text-sm"
      >
        <section aria-label={activeProvider?.name ?? "Active provider"}>
          {activeProvider && (
            <h3 className="text-xs font-medium uppercase text-muted-foreground">
              {activeProvider.name}
            </h3>
          )}
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
                        ? "Could not list this provider's models."
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
              onChange={(id, value) => onConfigure({ [id]: value })}
            />
          </div>
        )}
        <div className="flex items-start justify-between gap-3 border-t border-border pt-2 text-xs text-muted-foreground">
          <p>
            Other harnesses and models need a{" "}
            <PopoverClose asChild>
              <button
                type="button"
                className="underline underline-offset-2 hover:text-foreground"
                onClick={onNewSession}
              >
                new session
              </button>
            </PopoverClose>
            .
          </p>
          <SetAsDefault
            agentId={agentId}
            pair={{
              harness,
              provider,
              model,
              ...(Object.keys(settings).length > 0 && { settings }),
            }}
            remembered={remembered}
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}
