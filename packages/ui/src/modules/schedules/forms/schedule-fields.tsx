import { Information } from "@carbon/icons-react";
import { useId } from "react";
import type {
  Control,
  FieldErrors,
  FieldValues,
  Path,
  UseFormRegister,
  UseFormRegisterReturn,
} from "react-hook-form";
import { Controller, useController, useWatch } from "react-hook-form";

import { Input } from "@/components/ui/input";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { SectionLabel } from "@/components/ui/section-label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { HintTooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import { FormError } from "../../../components/form-error.js";
import { FormField } from "../../../components/form-field.js";
import { useHarnessConfigStatus } from "../../agents/api/harness-config.js";
import { useIsAgentOperable } from "../../agents/api/queries.js";
import { useProfiles } from "../../profiles/api/queries.js";
import { ProfilePicker } from "../../profiles/components/profile-picker.js";
import { useProfileAttach } from "../../profiles/hooks/use-profile-attach.js";
import {
  useHarnessCatalog,
  useHarnessCatalogModels,
  useHarnessConfigured,
  useProviderConnections,
  useSessionDefaults,
} from "../../sessions/api/session-pair.js";
import { AwakeModelsGate } from "../../sessions/components/awake-models-gate.js";
import {
  type Choice,
  OptionPicker,
} from "../../sessions/components/model-settings-panel.js";
import { SessionSettingsControls } from "../../sessions/components/session-settings-controls.js";
import {
  findModel,
  modelGroups,
  modelIndicatorLabel,
  sameSideGroups,
} from "../../sessions/lib/catalog-groups.js";
import { fittingProviders } from "../../sessions/lib/session-pair-options.js";
import {
  applySettingChanges,
  settingDefaults,
  settingsForModel,
} from "../../sessions/lib/session-settings.js";
import {
  useHasHarnessDefault,
  useScheduleDefault,
  useSessionModelChoices,
} from "../api/session-model.js";
import {
  DAYS_ISO,
  formatTime12,
  RUN_OPTIONS,
  TIME_OPTIONS,
  TIMEZONE_OPTIONS,
} from "../lib/schedule-form-options.js";
import {
  buildRRuleParts,
  errorField,
  type ScheduleFormValues,
} from "./schedule-form-schema.js";

const SESSION_TOOLTIP =
  "Fresh starts a new session each run. Continuous resumes one ongoing session, keeping context across runs.";

type ScheduleFieldLayout = "stacked" | "rows";

interface FieldsProps {
  layout: ScheduleFieldLayout;
  control: Control<ScheduleFormValues>;
  register: UseFormRegister<ScheduleFormValues>;
  errors: FieldErrors<ScheduleFormValues>;
  values: ScheduleFormValues;
  accentClassName?: string;
}

const DEFAULT_ACCENT = "bg-primary text-primary-foreground";

function Field({
  layout,
  label,
  hint,
  error,
  children,
}: {
  layout: ScheduleFieldLayout;
  label: string;
  hint?: React.ReactNode;
  error?: string | undefined;
  children: React.ReactNode;
}) {
  if (layout === "rows")
    return (
      <div className="px-4 py-2">
        <div className="flex items-center justify-between gap-4">
          <span className="flex shrink-0 items-center gap-1.5 text-sm text-foreground">
            {label}
            {hint}
          </span>
          <div className="w-[260px] shrink-0">{children}</div>
        </div>
        {error && (
          <div className="mt-1 flex justify-end">
            <FormError message={error} />
          </div>
        )}
      </div>
    );

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1.5">
        <SectionLabel>{label}</SectionLabel>
        {hint}
      </div>
      {children}
      <FormError message={error} />
    </div>
  );
}

function Chip({
  selected,
  accentClassName,
  compact,
  onClick,
  children,
}: {
  selected: boolean;
  accentClassName: string;
  compact: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full text-xs font-medium",
        compact ? "px-2 py-0.5" : "px-3 py-1",
        selected ? accentClassName : "bg-muted text-muted-foreground",
      )}
    >
      {children}
    </button>
  );
}

export function ScheduleRecurrenceFields({
  layout,
  control,
  register,
  errors,
  values,
  accentClassName = DEFAULT_ACCENT,
}: FieldsProps) {
  const rows = layout === "rows";
  const selectProps = rows
    ? ({ variant: "ghost", size: "sm" } as const)
    : ({ className: "h-10" } as const);
  const cadence = buildRRuleParts(values);

  const timeOptions = TIME_OPTIONS.some((o) => o.value === values.time)
    ? TIME_OPTIONS
    : [
        { value: values.time, label: formatTime12(values.time) },
        ...TIME_OPTIONS,
      ];

  return (
    <>
      <Field layout={layout} label="Repeat">
        <Select {...selectProps} {...register("kind")}>
          {RUN_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      </Field>

      {values.kind === "daily" && (
        <Field layout={layout} label="Time">
          <Select {...selectProps} {...register("time")}>
            {timeOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
      )}

      {(values.kind === "minutely" || values.kind === "hourly") && (
        <Field
          layout={layout}
          label="Every"
          {...(cadence.error ? { error: cadence.error } : {})}
        >
          <div
            className={cn(
              "flex items-center gap-2 text-sm text-foreground",
              rows && "justify-end",
            )}
          >
            <Input
              type="number"
              min={1}
              className={cn("w-[80px]", rows ? "h-8" : "h-10")}
              variant={cadence.error ? "invalid" : undefined}
              {...register("interval")}
            />
            <span>{values.kind === "minutely" ? "minutes" : "hours"}</span>
          </div>
        </Field>
      )}

      {values.kind !== "custom" && (
        <Field
          layout={layout}
          label="Days"
          {...(errors.days?.message ? { error: errors.days.message } : {})}
        >
          <Controller
            control={control}
            name="days"
            render={({ field }) => (
              <div
                className={cn(
                  "flex flex-wrap gap-1.5",
                  rows && "justify-end gap-1",
                )}
              >
                {DAYS_ISO.map((d) => (
                  <Chip
                    key={d.iso}
                    selected={field.value.includes(d.iso)}
                    accentClassName={accentClassName}
                    compact={rows}
                    onClick={() =>
                      field.onChange(
                        field.value.includes(d.iso)
                          ? field.value.filter((v) => v !== d.iso)
                          : [...field.value, d.iso].sort(),
                      )
                    }
                  >
                    {d.label}
                  </Chip>
                ))}
              </div>
            )}
          />
        </Field>
      )}

      {values.kind === "custom" && (
        <Field
          layout={layout}
          label="RRULE"
          {...(cadence.error ? { error: cadence.error } : {})}
        >
          <Input
            className={cn("font-mono text-xs", rows ? "h-8" : "h-10")}
            variant={cadence.error ? "invalid" : undefined}
            placeholder="FREQ=WEEKLY;BYDAY=MO,WE;BYHOUR=7;BYMINUTE=30"
            {...register("customRRule")}
          />
        </Field>
      )}

      {cadence.error
        ? errorField(values.kind) === "kind" && (
            <FormError message={cadence.error} />
          )
        : !rows &&
          cadence.summary && (
            <p className="-mt-1 text-sm text-muted-foreground">
              {cadence.summary}
            </p>
          )}

      <Field
        layout={layout}
        label="Timezone"
        {...(errors.timezone?.message
          ? { error: errors.timezone.message }
          : {})}
      >
        <Controller
          control={control}
          name="timezone"
          render={({ field }) => (
            <SearchableSelect
              value={field.value}
              onChange={field.onChange}
              options={TIMEZONE_OPTIONS}
              placeholder="Select a timezone"
              invalid={!!errors.timezone}
              {...(rows
                ? {
                    className:
                      "h-8 border-transparent bg-transparent text-xs hover:border-input hover:bg-background",
                  }
                : {})}
            />
          )}
        />
      </Field>
    </>
  );
}

export function ScheduleSessionTypeField<T extends FieldValues>({
  layout,
  control,
  accentClassName = DEFAULT_ACCENT,
}: {
  layout: ScheduleFieldLayout;
  control: Control<T>;
  accentClassName?: string;
}) {
  return (
    <Field
      layout={layout}
      label="Session type"
      hint={
        <HintTooltip
          content={SESSION_TOOLTIP}
          label="About session types"
          side="top"
          className="text-muted-foreground"
        >
          <Information size={14} />
        </HintTooltip>
      }
    >
      <Controller
        control={control}
        name={"sessionMode" as Path<T>}
        render={({ field }) => (
          <div
            className={cn("flex gap-1.5", layout === "rows" && "justify-end")}
          >
            {(["fresh", "continuous"] as const).map((mode) => (
              <Chip
                key={mode}
                selected={field.value === mode}
                accentClassName={accentClassName}
                compact={false}
                onClick={() => field.onChange(mode)}
              >
                <span className="capitalize">{mode}</span>
              </Chip>
            ))}
          </div>
        )}
      />
    </Field>
  );
}

const PRECHECK_HINT =
  "A shell command run in the agent's workspace before each run. Exit 0 runs the task, exit 1 skips this run, and any other exit runs it anyway. What it prints is added to the prompt.";

const PRECHECK_PLACEHOLDER =
  "git fetch -q && git log --oneline HEAD..origin/main | grep -q .";

interface PrecheckFieldProps {
  layout: ScheduleFieldLayout;
  registration: UseFormRegisterReturn;
  error?: string | undefined;
}

export function SchedulePrecheckField({
  layout,
  registration,
  error,
}: PrecheckFieldProps) {
  const fieldId = useId();
  const input = (
    <Textarea
      id={fieldId}
      className="min-h-[56px] resize-y font-mono text-xs"
      variant={error ? "invalid" : undefined}
      placeholder={PRECHECK_PLACEHOLDER}
      rows={2}
      {...registration}
    />
  );

  if (layout === "stacked")
    return (
      <FormField label="Precheck (optional)" error={error} hint={PRECHECK_HINT}>
        {input}
      </FormField>
    );

  return (
    <div className="px-4 py-3">
      <div className="mb-2 flex items-center gap-1.5">
        <label htmlFor={fieldId}>
          <SectionLabel>Precheck (optional)</SectionLabel>
        </label>
        <HintTooltip
          content={PRECHECK_HINT}
          label="About prechecks"
          side="top"
          className="text-muted-foreground"
        >
          <Information size={14} />
        </HintTooltip>
      </div>
      {input}
      <FormError message={error} />
    </div>
  );
}

const MODEL_HINT =
  "Default is the harness's own default; where the agent has none, a schedule without a model follows the agent's model.";

/**
 * UNIT_BOUNDARY_DESCRIPTION: Old runtime path: remove when agents.runtimeFleet.outdated is empty on prod.
 * The single model field of a schedule: a bare name from the agent's list.
 */
export function ScheduleModelField({
  agentId,
  value,
  onChange,
}: {
  agentId: string;
  value: string;
  onChange: (model: string) => void;
}) {
  const choices = useSessionModelChoices(agentId || null);
  const hasDefault = useHasHarnessDefault(agentId || null);
  const supported = choices.length > 0;
  if (!supported && !value) return null;
  const options: Choice[] = choices.map((c) => ({
    id: c.value,
    name: c.name,
    description: c.description,
  }));
  if (value && !options.some((c) => c.id === value))
    options.push({
      id: value,
      name: value,
      description: supported
        ? "Not in this agent's model list"
        : "This agent can't switch a session's model; clear it so runs follow the agent",
    });

  return (
    <FormField label="Model" hint={MODEL_HINT}>
      <OptionPicker
        title="Model"
        choices={options}
        value={value || null}
        clearable
        {...(hasDefault
          ? {}
          : {
              placeholder: "Same as agent",
              clearedLabel: "Same as agent",
              clearedDescription: "Follows the model the agent is set to",
            })}
        onSelect={(id) => onChange(id ?? "")}
      />
    </FormField>
  );
}

const SESSION_TITLE_HINT =
  "Shown in the session list instead of the title the agent derives from the prompt. Every run of a fresh schedule gets the same title.";

export function ScheduleSessionTitleField({
  registration,
  error,
}: {
  registration: UseFormRegisterReturn;
  error?: string | undefined;
}) {
  return (
    <FormField
      label="Session title (optional)"
      error={error}
      hint={SESSION_TITLE_HINT}
    >
      <Input
        variant={error ? "invalid" : undefined}
        placeholder="Derived from the prompt"
        {...registration}
      />
    </FormField>
  );
}

interface ChoicesControl {
  harness: string;
  model: string;
  settings: Record<string, string>;
  profile: string;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: what a schedule runs on (D92): one profile of the
 * owner's, preselected from the agent's newest schedule, with "Custom
 * selection" for a schedule that carries its own harness, model and settings —
 * which is also what a schedule written before profiles keeps showing until
 * someone picks one.
 */
export function ScheduleChoicesField<T extends ChoicesControl>({
  agentId,
  control,
  migrationNote,
}: {
  agentId: string;
  control: Control<T>;
  migrationNote: string | null;
}) {
  const typed = control as unknown as Control<ChoicesControl>;
  const { data: profiles = [] } = useProfiles(agentId);
  const { attach, manage } = useProfileAttach(agentId);
  const { field: profileField } = useController({
    control: typed,
    name: "profile",
  });
  if (profiles.length === 0)
    return (
      <CustomChoicesField
        agentId={agentId}
        control={typed}
        migrationNote={migrationNote}
      />
    );
  return (
    <div className="flex flex-col gap-4">
      <FormField
        label="Profile"
        hint="What this schedule runs on. Editing the profile changes every schedule that names it; Custom selection gives this one its own."
      >
        <ProfilePicker
          label="Profile"
          showLabel={false}
          profiles={profiles}
          value={profileField.value || null}
          placeholder="Custom selection"
          custom={{
            label: "Custom selection",
            description: "A harness, model and settings for this schedule only",
          }}
          onPick={(profile) => profileField.onChange(profile.id)}
          onCustom={() => profileField.onChange("")}
          onAttach={(profile) => void attach(profile)}
          onManage={manage}
          testId="schedule-profile"
        />
      </FormField>
      {!profileField.value && (
        <CustomChoicesField
          agentId={agentId}
          control={typed}
          migrationNote={migrationNote}
        />
      )}
    </div>
  );
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: the same three choices a session picks, for a
 * schedule that carries them instead of naming a profile (D92). The empty
 * choice is not a scheduled default — nothing writes one any more (D90) — it is
 * the agent's chat default, and it says what that is now. On a runtime without
 * the Model Router the old single model field stands.
 */
function CustomChoicesField({
  agentId,
  control,
  migrationNote,
}: {
  agentId: string;
  control: Control<ChoicesControl>;
  migrationNote: string | null;
}) {
  const typed = control as unknown as Control<ChoicesControl>;
  const { data: status } = useHarnessConfigStatus(agentId || null);
  const agentOperable = useIsAgentOperable(agentId || null);
  const routed = status?.modelRouter ?? false;
  const harnessValue = useWatch({ control: typed, name: "harness" });
  const { field: modelField } = useController({
    control: typed,
    name: "model",
  });
  const { field: settingsField } = useController({
    control: typed,
    name: "settings",
  });
  const { data: savedDefaults } = useSessionDefaults(
    routed && agentId ? agentId : null,
  );
  const sameAsChat = savedDefaults !== undefined && !savedDefaults.scheduled;
  const storedModel = modelField.value;
  const settingsValue = settingsField.value;
  const { data: catalog } = useHarnessCatalog();
  const carried = status?.harnesses ?? [];
  const { data: fallback } = useScheduleDefault(
    routed && agentId ? agentId : null,
    harnessValue || null,
  );
  const harness =
    harnessValue ||
    fallback?.harness ||
    status?.defaultHarness ||
    carried[0]?.name ||
    "";
  const { data: catalogModels } = useHarnessCatalogModels(
    routed && agentId ? agentId : null,
    routed ? harness || null : null,
  );
  const { granted } = useProviderConnections(routed ? agentId : null);
  const capability = carried.find((h) => h.name === harness);
  const defaults = settingDefaults(
    capability,
    useHarnessConfigured(agentId, harness),
    storedModel || fallback?.model || null,
  );
  const listedByRunningAgent =
    !status?.harnesses ||
    (!routed && status.sessionModel && !!status.defaultHarness);
  if (agentId && status && !agentOperable && listedByRunningAgent)
    return (
      <FormField label="Model">
        <AwakeModelsGate agentId={agentId} />
      </FormField>
    );
  if (!routed)
    return (
      <ScheduleModelField
        agentId={agentId}
        value={modelField.value}
        onChange={modelField.onChange}
      />
    );
  const groups = modelGroups(catalogModels);
  const modelValue = storedModel
    ? (findModel(groups, storedModel)?.model.name ?? storedModel)
    : storedModel;
  const fitting = fittingProviders(catalog?.harnesses ?? [], granted);
  const harnessChoices: Choice[] = carried
    .filter((h) => h.name === harnessValue || fitting(h.name).length > 0)
    .map((h) => ({
      id: h.name,
      name:
        catalog?.harnesses.find((v) => v.name === h.name)?.displayName ??
        h.name,
    }));
  const modelChoices: Choice[] = groups.flatMap((g) =>
    g.models.map((m) => ({
      id: m.name,
      name: `${m.upstreamId} · ${g.displayName}`,
    })),
  );
  if (modelValue && !modelChoices.some((c) => c.id === modelValue))
    modelChoices.push({
      id: modelValue,
      name: modelValue,
      ...(catalogModels !== undefined && {
        description: "Not in this agent's model list",
      }),
    });
  const todayModel = fallback?.model
    ? modelIndicatorLabel(groups, fallback.model)
    : null;
  const now = (value: string) =>
    sameAsChat ? `Now: ${value}, the agent's chat default` : `Now: ${value}`;
  const defaultHint =
    "Left as the agent's chat default, a schedule runs on whatever the agent's chat default is, which a chat's model picker sets.";
  return (
    <div className="flex flex-col gap-4">
      <FormField label="Harness" hint={defaultHint}>
        <Controller
          control={typed}
          name="harness"
          render={({ field }) => (
            <OptionPicker
              title="Harness"
              choices={harnessChoices}
              value={field.value || null}
              clearable
              placeholder="The agent's chat default"
              clearedLabel="The agent's chat default"
              clearedDescription={
                fallback?.harness
                  ? now(
                      harnessChoices.find((c) => c.id === fallback.harness)
                        ?.name ?? fallback.harness,
                    )
                  : "Follows the agent's chat default"
              }
              onSelect={(id) => {
                field.onChange(id ?? "");
                modelField.onChange("");
                settingsField.onChange({});
              }}
            />
          )}
        />
      </FormField>
      <FormField
        label="Model"
        hint="Each model is named with its provider. The agent's chat default runs on its model for the harness."
        {...(migrationNote ? { error: migrationNote } : {})}
      >
        <AwakeModelsGate agentId={agentId}>
          <OptionPicker
            title="Model"
            choices={modelChoices}
            value={modelValue || null}
            clearable
            placeholder="The agent's chat default"
            clearedLabel="The agent's chat default"
            clearedDescription={
              todayModel ? now(todayModel) : "Follows the agent's chat default"
            }
            onSelect={(id) => {
              modelField.onChange(id ?? "");
              if (!id && fallback === undefined) return;
              const current = settingsValue ?? {};
              const kept = settingsForModel(
                capability,
                groups,
                id || fallback?.model || null,
                current,
              );
              if (Object.keys(kept).length !== Object.keys(current).length)
                settingsField.onChange(kept);
            }}
          />
        </AwakeModelsGate>
      </FormField>
      {capability?.sessionSettings && capability.sessionSettings.length > 0 && (
        <FormField label="Session settings">
          <SessionSettingsControls
            agentId={agentId}
            carried={carried}
            capability={capability}
            model={modelValue || fallback?.model || null}
            settings={settingsValue ?? {}}
            defaults={defaults}
            modelChoices={sameSideGroups(
              groups,
              modelValue || fallback?.model || null,
            ).flatMap((g) =>
              g.models.map((m) => ({
                value: m.name,
                name: `${m.upstreamId} · ${g.displayName}`,
              })),
            )}
            onChange={(changes) =>
              settingsField.onChange(
                applySettingChanges(settingsValue ?? {}, changes),
              )
            }
          />
        </FormField>
      )}
    </div>
  );
}
