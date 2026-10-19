import type { HarnessCapability } from "agent-runtime-api";
import { platformSubagentChoice } from "agent-runtime-api";
import { Fragment } from "react";

import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";

import {
  useHarnessCatalog,
  useHarnessCatalogModels,
} from "../api/session-pair.js";
import { modelGroups } from "../lib/catalog-groups.js";
import {
  platformHarnessChange,
  platformKey,
  platformModelChange,
  platformSubagentOptions,
} from "../lib/platform-subagent-settings.js";
import { harnessDisplayName } from "../lib/session-pair-options.js";

const AGENT_PICKS = "Agent picks";

/**
 * UNIT_BOUNDARY_DESCRIPTION: the rows that set what the session's platform
 * sub-agents run on: a harness, then that harness's models and settings.
 * Unset, the agent picks per spawn.
 */
export function PlatformSubagentSettings({
  agentId,
  carried,
  settings,
  idPrefix,
  disabled,
  onChange,
}: {
  agentId: string;
  carried: readonly HarnessCapability[];
  settings: Readonly<Record<string, string>>;
  idPrefix: string;
  disabled: boolean;
  onChange: (changes: Record<string, string>) => void;
}) {
  const choice = platformSubagentChoice(settings);
  const harness = choice?.harness ?? null;
  const capability = carried.find((h) => h.name === harness);
  const { data: catalog } = useHarnessCatalog();
  const catalogModels = useHarnessCatalogModels(agentId, harness);
  const models = modelGroups(catalogModels.data, catalogModels.granted).flatMap(
    (g) =>
      g.models.map((m) => ({
        value: m.name,
        name: `${m.upstreamId} · ${g.displayName}`,
      })),
  );
  const options = platformSubagentOptions(capability, choice?.model);
  const modelsNote = !catalogModels.operable
    ? "Start the agent to list models."
    : (catalogModels.isLoading || catalogModels.waiting) && models.length === 0
      ? "Loading models…"
      : catalogModels.isError && models.length === 0
        ? "Couldn't load the models."
        : null;
  const row = (
    id: string,
    label: string,
    value: string,
    choices: readonly { value: string; name: string }[],
    change: (value: string) => Record<string, string>,
  ) => (
    <Fragment key={id}>
      <label
        htmlFor={`${idPrefix}-platform-${id}`}
        className="text-muted-foreground"
      >
        {label}
      </label>
      <Select
        id={`${idPrefix}-platform-${id}`}
        size="xs"
        variant="ghost"
        disabled={disabled}
        value={value}
        onChange={(e) => onChange(change(e.target.value))}
      >
        <option value="">{AGENT_PICKS}</option>
        {value !== "" && !choices.some((c) => c.value === value) && (
          <option value={value}>{value}</option>
        )}
        {choices.map((c) => (
          <option key={c.value} value={c.value}>
            {c.name}
          </option>
        ))}
      </Select>
    </Fragment>
  );
  return (
    <>
      {row(
        "harness",
        "Harness",
        harness ?? "",
        carried
          .filter((h) => h.harnessConfigCatalog)
          .map((h) => ({
            value: h.name,
            name: harnessDisplayName(h.name, catalog?.harnesses) ?? h.name,
          })),
        (value) => platformHarnessChange(settings, value),
      )}
      {harness &&
        row("model", "Model", choice?.model ?? "", models, (value) =>
          platformModelChange(
            capability?.harnessConfigCatalog,
            settings,
            value,
          ),
        )}
      {harness && modelsNote && (
        <p className="col-span-2 text-muted-foreground">
          {modelsNote}
          {catalogModels.isError && (
            <Button
              variant="link"
              size="inline"
              className="ml-1"
              onClick={() => void catalogModels.refetch()}
            >
              Retry
            </Button>
          )}
        </p>
      )}
      {harness &&
        options.map((o) =>
          row(
            o.id,
            o.name,
            (o.id === "mode" ? choice?.mode : choice?.configOptions?.[o.id]) ??
              "",
            o.choices,
            (value) => ({ [platformKey(o.id)]: value }),
          ),
        )}
    </>
  );
}
