import { Boxes, FlaskConical, Library, Puzzle, Terminal } from "lucide-react";

import { SectionLabel } from "@/components/ui/section-label";

import { ListSkeleton } from "../../../../components/list-skeleton.js";
import type { TemplateView } from "../../../../types.js";
import { KB_TEMPLATES } from "../../../knowledge-bases/lib/kb-templates.js";
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
  onPickStartingPoint,
  onPickTemplate,
  onPickKbTemplate,
  onCustomImageChange,
  onContinue,
}: Props) {
  const { startingPoint } = snapshot;
  // Both kinded paths pin one harness image. An install whose template set omits
  // it cannot create either, so offer neither and say why — otherwise the user
  // gets through all three steps and fails at the create call.
  const kindedHarnessInstalled =
    loading || templates.some((t) => t.id === KINDED_HARNESS_TEMPLATE_ID);

  return (
    <div>
      <StepHeader
        step={1}
        title="Choose your starting point"
        subtitle="Every sandbox boots from an image. Start with one already set up for a particular job, or take a general-purpose image and configure it yourself."
      />

      {!kindedHarnessInstalled && (
        <p className="mb-6 rounded-md border border-warning/40 bg-warning/10 px-4 py-3 text-[13px] text-warning">
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
            icon={FlaskConical}
            name="Experiment sandbox"
            description="A Claude Code sandbox with the experiment authoring skill installed. It runs one goal across several variants at once and charts each result live, so you can compare them."
            selected={startingPoint === "experiment"}
            onSelect={() => onPickStartingPoint("experiment")}
          />
        )}
        {kindedHarnessInstalled && (
          <StartingPointRow
            startingPoint="knowledge-base"
            icon={Library}
            name="Knowledge base sandbox"
            description="A Claude Code sandbox that builds and maintains a body of knowledge you can chat with. Feed it a repo or your docs, or add to it as you go."
            selected={startingPoint === "knowledge-base"}
            onSelect={() => onPickStartingPoint("knowledge-base")}
          />
        )}
        <StartingPointRow
          startingPoint="specialized"
          icon={Puzzle}
          name="Specialized sandbox"
          description="An image already built for one particular task — optimizers, research harnesses, and more."
          selected={startingPoint === "specialized"}
          onSelect={() => onPickStartingPoint("specialized")}
        />
        <StartingPointRow
          startingPoint="general-purpose"
          icon={Boxes}
          name="General-purpose sandbox"
          description="A capable coding agent with no preset — code, research, ops, or anything else. Pick the harness to start from."
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
        onPickTemplate={onPickTemplate}
        onPickKbTemplate={onPickKbTemplate}
        onCustomImageChange={onCustomImageChange}
        onContinue={onContinue}
      />
    </div>
  );
}

/** What the chosen starting point needs next. */
function StartingPointReveal({
  snapshot,
  templates,
  loading,
  registry,
  onPickTemplate,
  onPickKbTemplate,
  onCustomImageChange,
  onContinue,
}: Omit<Props, "onPickStartingPoint">) {
  if (snapshot.startingPoint === "knowledge-base") {
    return (
      <section className="anim-in">
        <SectionLabel spaced>Template</SectionLabel>
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
            templates
              .filter((t) => t.category === "harness")
              .map((template) => (
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
    const specialized = templates.filter((t) => t.category === "preconfigured");
    return (
      <section className="anim-in">
        <SectionLabel spaced>Choose an image</SectionLabel>
        <p className="mb-3 text-[14px] text-muted-foreground">
          Each boots its own sandbox, already set up for its task. Early and
          evolving.
        </p>
        {loading ? (
          <ListSkeleton rows={3} rowHeight={64} />
        ) : specialized.length === 0 ? (
          <p className="text-[14px] text-muted-foreground">
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
