import {
  Add,
  ChevronDown,
  ChevronUp,
  Close,
  Edit as EditIcon,
  OverflowMenuVertical,
  Time,
} from "@carbon/icons-react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";

import {
  DialogActions,
  DialogBody,
  DialogHeader,
  Modal,
} from "@/components/modal";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Card } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Inset } from "@/components/ui/inset";
import { SectionLabel } from "@/components/ui/section-label";
import { Switch } from "@/components/ui/switch";

import type { ScheduleDraft } from "../../sandboxes/hooks/use-setup-form.js";
import { ScheduleFormFields } from "../forms/schedule-form-fields.js";
import {
  buildRRuleParts,
  scheduleFormDefaults,
  scheduleFormSchema,
  type ScheduleFormValues,
} from "../forms/schedule-form-schema.js";

interface Props {
  drafts: ScheduleDraft[];
  onDraftsChange: (drafts: ScheduleDraft[]) => void;
  presetIndices?: Set<number>;
}

export function ScheduleSetupSection({
  drafts,
  onDraftsChange,
  presetIndices,
}: Props) {
  const [modalState, setModalState] = useState<
    { mode: "create" } | { mode: "edit"; index: number } | null
  >(null);
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);

  const handleCreate = (values: ScheduleFormValues) => {
    onDraftsChange([...drafts, { ...values, enabled: true }]);
    setModalState(null);
  };

  const handleEdit = (index: number, values: ScheduleFormValues) => {
    const next = [...drafts];
    next[index] = { ...values, enabled: drafts[index]!.enabled ?? true };
    onDraftsChange(next);
    setModalState(null);
  };

  const handleDelete = (index: number) => {
    onDraftsChange(drafts.filter((_, i) => i !== index));
    if (expandedIndex === index) setExpandedIndex(null);
  };

  const handleToggle = (index: number) => {
    const next = [...drafts];
    const d = next[index]!;
    next[index] = { ...d, enabled: !(d.enabled ?? true) };
    onDraftsChange(next);
  };

  if (drafts.length === 0) {
    return (
      <section className="mb-8">
        <SectionLabel spaced>
          Schedule{" "}
          <span className="font-normal text-muted-foreground">(optional)</span>
        </SectionLabel>
        <Callout inset className="bg-card">
          <div className="flex flex-col items-center gap-4 py-6">
            <p className="text-center text-sm text-foreground/80">
              Automate this agent on a recurring schedule,
              <br />
              you can also create schedules by chatting with your agent
            </p>
            <Button
              variant="outline"
              onClick={() => setModalState({ mode: "create" })}
            >
              <Time size={16} />
              Create schedule
            </Button>
          </div>
        </Callout>
        {modalState?.mode === "create" && (
          <ScheduleSetupModal
            onClose={() => setModalState(null)}
            onSave={handleCreate}
          />
        )}
      </section>
    );
  }

  return (
    <section className="mb-8">
      <div className="mb-3 flex items-center justify-between">
        <SectionLabel>Schedules</SectionLabel>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setModalState({ mode: "create" })}
        >
          <Add size={16} />
          Create Schedule
        </Button>
      </div>
      <Inset className="flex flex-col gap-3">
        {drafts.map((draft, index) => (
          <ScheduleDraftCard
            key={index}
            draft={draft}
            isPreset={presetIndices?.has(index) ?? false}
            isExpanded={expandedIndex === index}
            onToggleExpanded={() =>
              setExpandedIndex((prev) => (prev === index ? null : index))
            }
            onEdit={() => setModalState({ mode: "edit", index })}
            onDelete={() => handleDelete(index)}
            onToggle={() => handleToggle(index)}
          />
        ))}
      </Inset>
      {modalState?.mode === "create" && (
        <ScheduleSetupModal
          onClose={() => setModalState(null)}
          onSave={handleCreate}
        />
      )}
      {modalState?.mode === "edit" && (
        <ScheduleSetupModal
          initial={drafts[modalState.index]}
          onClose={() => setModalState(null)}
          onSave={(values) => handleEdit(modalState.index, values)}
        />
      )}
    </section>
  );
}

function ScheduleDraftCard({
  draft,
  isPreset,
  isExpanded,
  onToggleExpanded,
  onEdit,
  onDelete,
  onToggle,
}: {
  draft: ScheduleDraft;
  isPreset: boolean;
  isExpanded: boolean;
  onToggleExpanded: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onToggle: () => void;
}) {
  const enabled = draft.enabled ?? true;
  const cadence = buildRRuleParts(draft);

  return (
    <Card
      className={
        isPreset ? "border-preset-border/50 bg-preset-light/60" : undefined
      }
    >
      <div className="flex items-center gap-3 p-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-[15px] font-semibold text-foreground">
              {draft.name || "Untitled schedule"}
            </p>
            {isPreset && <Badge variant="preset">Preset</Badge>}
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-sm text-muted-foreground">
            {cadence.summary && (
              <span className="truncate">{cadence.summary}</span>
            )}
          </div>
        </div>

        {isPreset ? (
          <>
            <Switch
              checked={enabled}
              onCheckedChange={onToggle}
              label={enabled ? "Disable schedule" : "Enable schedule"}
            />
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-foreground"
              onClick={onEdit}
            >
              <EditIcon size={16} />
              Edit
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground hover:bg-preset-border hover:text-foreground"
              onClick={onDelete}
              aria-label="Remove schedule"
            >
              <Close size={16} />
            </Button>
          </>
        ) : (
          <>
            <Switch
              checked={enabled}
              onCheckedChange={onToggle}
              label={enabled ? "Disable schedule" : "Enable schedule"}
            />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="text-muted-foreground"
                  aria-label="Schedule actions"
                >
                  <OverflowMenuVertical size={16} />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem onSelect={onEdit}>
                  Edit schedule
                </DropdownMenuItem>
                <DropdownMenuItem tone="danger" onSelect={onDelete}>
                  Delete schedule
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        )}
      </div>

      <button
        type="button"
        onClick={onToggleExpanded}
        className="flex w-full items-center gap-1 border-t border-border px-4 py-2.5 text-sm font-medium text-foreground hover:bg-muted"
      >
        {isExpanded ? (
          <>
            Hide details <ChevronUp size={14} />
          </>
        ) : (
          <>
            View details <ChevronDown size={14} />
          </>
        )}
      </button>

      {isExpanded && <DraftDetails draft={draft} />}
    </Card>
  );
}

function DetailCard({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <Callout size="sm">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="mt-1 text-sm font-medium text-foreground">{children}</div>
    </Callout>
  );
}

function DraftDetails({ draft }: { draft: ScheduleDraft }) {
  return (
    <div className="border-t border-border p-4">
      {draft.task && (
        <>
          <SectionLabel>Task</SectionLabel>
          <p className="mt-1 mb-4 whitespace-pre-wrap text-sm text-foreground">
            {draft.task}
          </p>
        </>
      )}
      <div className="grid grid-cols-2 gap-3">
        <DetailCard label="Next run">
          <span className="inline-flex items-center gap-1 text-muted-foreground">
            <Time size={12} /> After creation
          </span>
        </DetailCard>
        <DetailCard label="Last run">
          <span className="text-muted-foreground">Never run</span>
        </DetailCard>
        <DetailCard label="Timezone">{draft.timezone || "—"}</DetailCard>
        <DetailCard label="Session mode">
          <span className="capitalize">{draft.sessionMode ?? "fresh"}</span>
        </DetailCard>
      </div>
    </div>
  );
}

function ScheduleSetupModal({
  initial,
  onClose,
  onSave,
}: {
  initial?: ScheduleFormValues | null;
  onClose: () => void;
  onSave: (values: ScheduleFormValues) => void;
}) {
  const { control, register, handleSubmit, watch, formState } =
    useForm<ScheduleFormValues>({
      resolver: zodResolver(scheduleFormSchema),
      defaultValues: initial ? initial : scheduleFormDefaults(),
    });

  const onSubmit = handleSubmit((values) => {
    onSave(values);
  });

  return (
    <Modal>
      <form onSubmit={onSubmit} className="flex min-h-0 flex-col">
        <DialogHeader
          title={initial ? "Edit schedule" : "Create a new schedule"}
          onClose={onClose}
        />
        <DialogBody className="flex flex-col gap-4">
          <ScheduleFormFields
            control={control}
            register={register}
            watch={watch}
            errors={formState.errors}
          />
        </DialogBody>
        <DialogActions
          onCancel={onClose}
          label={initial ? "Save" : "Create"}
          pendingLabel="Saving…"
        />
      </form>
    </Modal>
  );
}
