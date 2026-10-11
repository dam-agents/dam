import { Information } from "@carbon/icons-react";
import type { HarnessCapability } from "agent-runtime-api";

import { HarnessIcons } from "@/components/harness-icons";
import {
  Popover,
  PopoverClose,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Tooltip } from "@/components/ui/tooltip";

import {
  useHarnessCatalog,
  useProviderConnections,
  useProviderModels,
  useRememberedPair,
} from "../api/session-pair.js";
import { SetAsDefault } from "./session-pair-picker.js";
import { SessionSettingsControls } from "./session-settings-controls.js";

const CONTEXT_HINT =
  "If you need to move over context from this conversation, ask the agent to save it to a file.";
const NEW_SESSION_HINT = `start a new session. ${CONTEXT_HINT}`;

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
        <div className="flex items-center gap-2 px-1 font-medium text-foreground">
          <span className="text-muted-foreground">
            <HarnessIcons harnesses={[harness]} size="xs" />
          </span>
          <span className="flex-1 truncate">{harnessName}</span>
          <Tooltip content={`To use a different harness, ${NEW_SESSION_HINT}`}>
            <button
              type="button"
              aria-label="About changing the harness"
              className="rounded p-0.5 text-muted-foreground hover:text-foreground"
            >
              <Information size={16} />
            </button>
          </Tooltip>
        </div>
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
            <li className="px-1 pb-1 pt-2 text-xs text-muted-foreground">
              To use a model from a different provider,{" "}
              <PopoverClose asChild>
                <button
                  type="button"
                  className="underline underline-offset-2 hover:text-foreground"
                  onClick={onNewSession}
                >
                  start a new session
                </button>
              </PopoverClose>
              . {CONTEXT_HINT}
            </li>
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
        <div className="flex justify-end border-t border-border pt-2 text-xs text-muted-foreground">
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
