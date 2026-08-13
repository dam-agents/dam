import {
  Book,
  Chemistry,
  Cube,
  Extensions,
  Terminal,
} from "@carbon/icons-react";

import { SectionLabel } from "@/components/ui/section-label";

import { ListSkeleton } from "../../../../components/list-skeleton.js";
import type { TemplateView } from "../../../../types.js";
import { KB_TEMPLATES } from "../../../knowledge-bases/lib/kb-templates.js";
import { imageCatalogue } from "../../lib/image-catalogue.js";
import {
  KINDED_HARNESS_TEMPLATE_ID,
  type StartingPoint,
  type WizardSnapshot,
} from "../../lib/wizard-snapshot.js";
import { CardList } from "../card-list.js";
import { StepHeader } from "../step-header.js";
import { CustomImageCard, type RegistryControls } from "./custom-image-card.js";
import { HarnessCard } from "./harness-card.js";
import { KbTemplateCard } from "./kb-template-card.js";
import { StartingPointRow } from "./starting-point-row.js";
import { WorkloadCard } from "./workload-card.js";

interface Props {
  snapshot: WizardSnapshot;
  templates: TemplateView[];
  loading: boolean;
  registry?: RegistryControls;
  vmFeatureEnabled: boolean;
  onPickStartingPoint: (startingPoint: StartingPoint) => void;
  onPickTemplate: (templateId: string) => void;
  onPickKbTemplate: (kbTemplateId: WizardSnapshot["kbTemplateId"]) => void;
  onCustomImageChange: (value: string) => void;
  onContinue: () => void;
}

export function StartingPointStep({
  snapshot,
  templates,
  loading,
  registry,
  vmFeatureEnabled,
  onPickStartingPoint,
  onPickTemplate,
  onPickKbTemplate,
  onCustomImageChange,
  onContinue,
}: Props) {
  const { startingPoint } = snapshot;
  const kindedHarnessInstalled =
    loading || templates.some((t) => t.id === KINDED_HARNESS_TEMPLATE_ID);

  return (
    <div>
      <StepHeader
        step={1}
        title="Choose your starting point"
        subtitle="Every sandbox starts from an image. Choose one configured for a specific job, or start with a general-purpose image and customize it yourself."
      />

      {!kindedHarnessInstalled && (
        <p className="mb-6 rounded-md border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning">
          Experiment and knowledge-base sandboxes need the{" "}
          <span className="font-mono">{KINDED_HARNESS_TEMPLATE_ID}</span> agent
          image, which is not installed on this platform. Ask your operator to
          enable it.
        </p>
      )}

      <CardList className="mb-8">
        {kindedHarnessInstalled && (
          <StartingPointRow
            startingPoint="experiment"
            icon={Chemistry}
            name="Experiment sandbox"
            description="A Claude Code sandbox with the experiment skill preloaded. It runs one goal across several variants at once, charting each result live so you can compare them."
            selected={startingPoint === "experiment"}
            onSelect={() => onPickStartingPoint("experiment")}
          />
        )}
        {kindedHarnessInstalled && (
          <StartingPointRow
            startingPoint="knowledge-base"
            icon={Book}
            name="Knowledge base sandbox"
            description="A Claude Code sandbox that builds and maintains a wiki. Ask questions in chat, add knowledge as you go, or point it at a repo or docs."
            selected={startingPoint === "knowledge-base"}
            onSelect={() => onPickStartingPoint("knowledge-base")}
          />
        )}
        <StartingPointRow
          startingPoint="specialized"
          icon={Extensions}
          name="Specialized sandbox"
          description="A sandbox already built for one particular task — optimizers, research harnesses, and more."
          selected={startingPoint === "specialized"}
          onSelect={() => onPickStartingPoint("specialized")}
        />
        <StartingPointRow
          startingPoint="general-purpose"
          icon={Cube}
          name="General-purpose sandbox"
          description="A capable agent with no preset — code, research, ops, or anything else. Pick a harness to start."
          selected={startingPoint === "general-purpose"}
          onSelect={() => onPickStartingPoint("general-purpose")}
        />
        <StartingPointRow
          startingPoint="custom"
          icon={Terminal}
          name="Custom image"
          description="Bring your own ACP-compatible agent image from any container registry."
          tag="Advanced"
          selected={startingPoint === "custom"}
          onSelect={() => onPickStartingPoint("custom")}
        />
      </CardList>

      <StartingPointReveal
        snapshot={snapshot}
        templates={templates}
        loading={loading}
        registry={registry}
        vmFeatureEnabled={vmFeatureEnabled}
        onPickTemplate={onPickTemplate}
        onPickKbTemplate={onPickKbTemplate}
        onCustomImageChange={onCustomImageChange}
        onContinue={onContinue}
      />
    </div>
  );
}

function StartingPointReveal({
  snapshot,
  templates,
  loading,
  registry,
  vmFeatureEnabled,
  onPickTemplate,
  onPickKbTemplate,
  onCustomImageChange,
  onContinue,
}: Omit<Props, "onPickStartingPoint">) {
  const catalogue = imageCatalogue(templates, { vmFeatureEnabled });
  if (snapshot.startingPoint === "knowledge-base") {
    return (
      <section className="anim-in">
        <SectionLabel spaced>Choose a template</SectionLabel>
        <CardList>
          {KB_TEMPLATES.map((template) => (
            <KbTemplateCard
              key={template.id}
              template={template}
              selected={snapshot.kbTemplateId === template.id}
              onSelect={() => onPickKbTemplate(template.id)}
            />
          ))}
        </CardList>
      </section>
    );
  }

  if (snapshot.startingPoint === "general-purpose") {
    return (
      <section className="anim-in">
        <SectionLabel spaced>Choose an image</SectionLabel>
        <CardList>
          {loading ? (
            <ListSkeleton rows={4} rowHeight={64} />
          ) : (
            catalogue.harnesses.map((template) => (
              <HarnessCard
                key={template.id}
                template={template}
                selected={template.id === snapshot.templateId}
                onSelect={() => onPickTemplate(template.id)}
              />
            ))
          )}
        </CardList>
      </section>
    );
  }

  if (snapshot.startingPoint === "specialized") {
    const specialized = catalogue.preconfigured;
    return (
      <section className="anim-in">
        <SectionLabel spaced>Choose an image</SectionLabel>
        <p className="mb-3 text-sm text-muted-foreground">
          Each boots its own sandbox, already set up for its task. Early and
          evolving.
        </p>
        {loading ? (
          <ListSkeleton rows={3} rowHeight={64} />
        ) : specialized.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No specialized images are installed on this platform.
          </p>
        ) : (
          <CardList>
            {specialized.map((template) => (
              <WorkloadCard
                key={template.id}
                template={template}
                selected={template.id === snapshot.templateId}
                onSelect={() => onPickTemplate(template.id)}
              />
            ))}
          </CardList>
        )}
      </section>
    );
  }

  if (snapshot.startingPoint === "custom") {
    return (
      <section className="anim-in">
        <SectionLabel spaced>Image address</SectionLabel>
        <CardList>
          <CustomImageCard
            value={snapshot.customImage}
            selected={snapshot.customImage.trim().length > 0}
            onChange={onCustomImageChange}
            onSubmit={onContinue}
            registry={registry}
          />
        </CardList>
      </section>
    );
  }

  return null;
}
