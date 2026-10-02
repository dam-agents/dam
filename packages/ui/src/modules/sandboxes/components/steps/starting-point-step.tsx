import { Book, Chemistry } from "@carbon/icons-react";
import { FlaskConical } from "lucide-react";

import { ListSkeleton } from "../../../../components/list-skeleton.js";
import type { TemplateView } from "../../../../types.js";
import type { KbTemplate } from "../../../knowledge-bases/lib/kb-templates.js";
import { imageCatalogue } from "../../lib/image-catalogue.js";
import type { WizardSnapshot } from "../../lib/wizard-snapshot.js";
import { StepHeader } from "../step-header.js";
import { CustomImageCard, type RegistryControls } from "./custom-image-card.js";
import { HarnessCard } from "./harness-card.js";
import { SelectableCard } from "./selectable-card.js";

interface Props {
  snapshot: WizardSnapshot;
  templates: TemplateView[];
  loading: boolean;
  registry?: RegistryControls;
  vmFeatureEnabled: boolean;
  kbTemplates?: readonly KbTemplate[];
  onPickTemplate: (templateId: string) => void;
  onPickExperimentTemplate?: (templateId: string | "scratch") => void;
  onPickKbTemplate?: (templateId: string) => void;
  onCustomImageChange: (value: string) => void;
  onContinue: () => void;
}

export function StartingPointStep({
  snapshot,
  templates,
  loading,
  registry,
  vmFeatureEnabled,
  kbTemplates,
  onPickTemplate,
  onPickExperimentTemplate,
  onPickKbTemplate,
  onCustomImageChange,
  onContinue,
}: Props) {
  if (snapshot.startingPoint === "experiment") {
    return (
      <ExperimentPicker
        snapshot={snapshot}
        templates={templates}
        vmFeatureEnabled={vmFeatureEnabled}
        onPick={onPickExperimentTemplate!}
      />
    );
  }

  if (snapshot.startingPoint === "knowledge-base") {
    return (
      <KbPicker
        snapshot={snapshot}
        kbTemplates={kbTemplates ?? []}
        onPick={onPickKbTemplate!}
      />
    );
  }

  const catalogue = imageCatalogue(templates, { vmFeatureEnabled });

  return (
    <div>
      <StepHeader
        step={1}
        title="Choose your starting point"
        subtitle="Select an agent image to run in your sandbox."
      />

      {loading ? (
        <ListSkeleton rows={4} rowHeight={80} />
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {catalogue.harnesses.map((template) => (
            <HarnessCard
              key={template.id}
              template={template}
              selected={template.id === snapshot.templateId}
              onSelect={() => onPickTemplate(template.id)}
            />
          ))}
        </div>
      )}

      <div className="relative my-6 flex items-center gap-3">
        <div className="h-px flex-1 bg-border" />
        <span className="text-[12px] text-muted-foreground">
          or use a custom image
        </span>
        <div className="h-px flex-1 bg-border" />
      </div>

      <CustomImageCard
        value={snapshot.customImage}
        selected={snapshot.customImage.trim().length > 0}
        onChange={onCustomImageChange}
        onSubmit={onContinue}
        registry={registry}
      />
    </div>
  );
}

function ExperimentPicker({
  snapshot,
  templates,
  vmFeatureEnabled,
  onPick,
}: {
  snapshot: WizardSnapshot;
  templates: TemplateView[];
  vmFeatureEnabled: boolean;
  onPick: (id: string | "scratch") => void;
}) {
  const catalogue = imageCatalogue(templates, { vmFeatureEnabled });

  return (
    <div>
      <StepHeader
        step={1}
        title="Choose your framework"
        subtitle="Pick an experiment framework, or start from scratch with a general-purpose sandbox."
      />

      <div className="grid grid-cols-2 gap-3">
        <SelectableCard
          selected={snapshot.experimentTemplateId === "scratch"}
          onSelect={() => onPick("scratch")}
          ariaLabel="Start from scratch"
          testId="template-card-scratch"
        >
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <div className="flex size-[38px] shrink-0 items-center justify-center rounded-lg border border-[#dde1e6]">
                <FlaskConical className="size-5 text-muted-foreground" />
              </div>
            </div>
            <div className="min-w-0">
              <p className="text-[16px] font-semibold text-foreground">
                Start from scratch
              </p>
              <p className="mt-1 text-[14px] leading-snug text-muted-foreground">
                General-purpose experiment sandbox
              </p>
            </div>
          </div>
        </SelectableCard>

        {catalogue.preconfigured.map((template) => (
          <SelectableCard
            key={template.id}
            selected={snapshot.experimentTemplateId === template.id}
            onSelect={() => onPick(template.id)}
            ariaLabel={template.name}
            testId={`template-card-${template.id}`}
          >
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <div className="flex size-[38px] shrink-0 items-center justify-center rounded-lg border border-[#dde1e6]">
                  <Chemistry className="size-5 text-muted-foreground" />
                </div>
                {template.tags && template.tags.length > 0 && (
                  <span className="shrink-0 text-[14px] text-muted-foreground">
                    {template.tags.join(" · ")}
                  </span>
                )}
              </div>
              <div className="min-w-0">
                <p className="text-[16px] font-semibold text-foreground">
                  {template.name}
                </p>
                {template.description && (
                  <p className="mt-1 text-[14px] leading-snug text-muted-foreground">
                    {template.description}
                  </p>
                )}
              </div>
            </div>
          </SelectableCard>
        ))}
      </div>
    </div>
  );
}

function KbPicker({
  snapshot,
  kbTemplates,
  onPick,
}: {
  snapshot: WizardSnapshot;
  kbTemplates: readonly KbTemplate[];
  onPick: (id: string) => void;
}) {
  return (
    <div>
      <StepHeader
        step={1}
        title="Choose your wiki style"
        subtitle="Pick how your knowledge base organizes information."
      />

      <div className="grid grid-cols-2 gap-3">
        {kbTemplates.map((template) => (
          <SelectableCard
            key={template.id}
            selected={snapshot.kbTemplateId === template.id}
            onSelect={() => onPick(template.id)}
            ariaLabel={template.name}
            testId={`kb-template-card-${template.id}`}
          >
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <div className="flex size-[38px] shrink-0 items-center justify-center rounded-lg border border-[#dde1e6]">
                  <Book className="size-5 text-muted-foreground" />
                </div>
              </div>
              <div className="min-w-0">
                <p className="text-[16px] font-semibold text-foreground">
                  {template.name}
                </p>
                <p className="mt-1 text-[14px] leading-snug text-muted-foreground">
                  {template.description}
                </p>
              </div>
            </div>
          </SelectableCard>
        ))}
      </div>
    </div>
  );
}
