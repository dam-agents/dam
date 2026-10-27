import { Information } from "@carbon/icons-react";
import type { HarnessCapability } from "agent-runtime-api";
import type { SessionPair } from "api-server-api";
import type { ReactNode } from "react";

import { HarnessIcons } from "@/components/harness-icons";
import { Tooltip } from "@/components/ui/tooltip";

import {
  useHarnessCatalog,
  useHarnessCatalogModels,
  useHarnessConfigured,
  useProviderConnections,
} from "../api/session-pair.js";
import { useConnectOnPick } from "../hooks/use-connect-on-pick.js";
import { modelGroups, sameSideGroups } from "../lib/catalog-groups.js";
import {
  harnessOptions,
  providerOptions,
} from "../lib/session-pair-options.js";
import {
  applySettingChanges,
  settingDefaults,
  settingsForModel,
} from "../lib/session-settings.js";
import { SessionModelList } from "./session-model-list.js";
import { SessionSettingsControls } from "./session-settings-controls.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: the one Custom screen every pick uses — a chat's
 * primary model and subagent slot, a profile in Settings and a schedule's own
 * values: the harnesses that can run, the models of every provider the owner
 * holds (one the agent lacks connects on pick), the session settings, which
 * never include tool approval, and the foot the caller gives. `harnesses` null
 * keeps the pair's harness, as a running session does.
 */
export function CustomPairScreen({
  agentId,
  carried,
  harnesses,
  pair,
  defaultHarness,
  subagent = false,
  inline = false,
  onChoose,
  onManageProviders,
  foot,
}: {
  agentId: string | null;
  carried: readonly HarnessCapability[];
  harnesses: readonly string[] | null;
  pair: SessionPair | null;
  defaultHarness: string;
  /** UNIT_BOUNDARY_DESCRIPTION: a subagent's settings take no model-valued setting, since it has no subagents of its own. */
  subagent?: boolean;
  /** UNIT_BOUNDARY_DESCRIPTION: in a form or a dialog rather than a picker's popover. */
  inline?: boolean;
  onChoose: (pair: SessionPair) => void;
  onManageProviders: () => void;
  foot?: ReactNode;
}) {
  const { data: catalog } = useHarnessCatalog();
  const views = catalog?.harnesses ?? [];
  const connections = useProviderConnections(agentId);
  const granted = agentId === null ? connections.owned : connections.granted;
  const harness = pair?.harness ?? defaultHarness;
  const capability = carried.find((h) => h.name === harness);
  const model = pair?.harness === harness ? pair.model : null;
  const settings = pair?.harness === harness ? (pair.settings ?? {}) : {};
  const defaults = settingDefaults(
    capability,
    useHarnessConfigured(agentId, harness),
    model,
  );
  const catalogModels = useHarnessCatalogModels(agentId, harness, {
    unattached: true,
  });
  const groups = modelGroups(catalogModels.data, catalogModels.granted);
  const connectOnPick = useConnectOnPick(agentId);
  const unsupported = (name: string) => {
    const fit = providerOptions(name, views, granted, connections.owned);
    return fit.granted.length === 0 && fit.addable.length === 0;
  };
  return (
    <>
      <div className="flex max-h-96 flex-col gap-2 overflow-y-auto p-1">
        {harnesses && harnesses.length > 0 && (
          <>
            <HarnessList
              agentId={agentId}
              names={harnesses}
              current={pair ? harness : ""}
              counted
              unsupported={unsupported}
              onPick={(name) =>
                onChoose({
                  harness: name,
                  provider:
                    providerOptions(name, views, granted, connections.owned)
                      .granted[0]?.id ?? null,
                  model: null,
                })
              }
            />
            <hr className="border-border" />
          </>
        )}
        <SessionModelList
          groups={groups}
          current={model}
          loading={catalogModels.isLoading}
          failed={catalogModels.isError}
          onRetry={() => void catalogModels.refetch()}
          onChoose={(name, group) =>
            connectOnPick(group, name, () => {
              const kept = settingsForModel(capability, groups, name, settings);
              onChoose({
                harness,
                provider: group.connectionId,
                model: name,
                ...(Object.keys(kept).length > 0 && { settings: kept }),
              });
            })
          }
          onManageProviders={onManageProviders}
          inline={inline}
        />
      </div>
      {pair && (
        <div className="border-t border-border px-2 pt-2 empty:hidden">
          <SessionSettingsControls
            agentId={agentId}
            carried={carried}
            capability={capability}
            model={model}
            settings={settings}
            defaults={defaults}
            modelChoices={
              subagent
                ? []
                : sameSideGroups(groups, model).flatMap((g) =>
                    g.models.map((m) => ({
                      value: m.name,
                      name: `${m.upstreamId} · ${g.displayName}`,
                    })),
                  )
            }
            onChange={(changes) =>
              onChoose({
                harness,
                provider: pair.provider,
                model,
                settings: applySettingChanges(settings, changes),
              })
            }
          />
        </div>
      )}
      {foot && <div className="border-t border-border px-2 pt-2">{foot}</div>}
    </>
  );
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: the harnesses a pick can land on; one no
 * provider the owner holds runs is grayed with the reason, and, `counted`,
 * one that lists no model cannot be picked either.
 */
export function HarnessList({
  agentId,
  names,
  current,
  counted,
  unsupported,
  onPick,
}: {
  agentId: string | null;
  names: readonly string[];
  current: string;
  counted: boolean;
  unsupported: (name: string) => boolean;
  onPick: (name: string) => void;
}) {
  const { data: catalog } = useHarnessCatalog();
  return (
    <ul role="group" aria-label="Harness" className="flex flex-col">
      {harnessOptions(names, catalog?.harnesses ?? []).map((h) => (
        <HarnessRow
          key={h.name}
          agentId={agentId}
          name={h.name}
          displayName={h.displayName}
          current={h.name === current}
          counted={counted}
          unsupported={unsupported(h.name)}
          onPick={() => onPick(h.name)}
        />
      ))}
    </ul>
  );
}

function HarnessRow({
  agentId,
  name,
  displayName,
  current,
  counted,
  unsupported,
  onPick,
}: {
  agentId: string | null;
  name: string;
  displayName: string;
  current: boolean;
  counted: boolean;
  unsupported: boolean;
  onPick: () => void;
}) {
  const { data } = useHarnessCatalogModels(agentId, counted ? name : null, {
    unattached: true,
  });
  const count = data?.providers.reduce(
    (total, provider) => total + provider.models.length,
    0,
  );
  return (
    <li className="flex items-center">
      <button
        type="button"
        disabled={unsupported || (count === 0 && !current)}
        aria-pressed={current}
        onClick={onPick}
        className="flex min-w-0 flex-1 items-center gap-2 rounded px-2 py-1.5 text-left text-muted-foreground hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-50 aria-pressed:bg-muted aria-pressed:font-medium aria-pressed:text-foreground"
      >
        <span className="text-muted-foreground">
          <HarnessIcons harnesses={[name]} size="xs" />
        </span>
        {displayName}
        {count !== undefined && (
          <span className="ml-auto shrink-0 text-xs text-muted-foreground">
            {count} {count === 1 ? "model" : "models"}
          </span>
        )}
      </button>
      {unsupported && (
        <Tooltip
          content={`${displayName} does not support any of the LLM providers you have configured.`}
        >
          <span
            tabIndex={0}
            aria-label={`Why ${displayName} is unavailable`}
            className="px-2 text-muted-foreground"
          >
            <Information size={14} />
          </span>
        </Tooltip>
      )}
    </li>
  );
}
