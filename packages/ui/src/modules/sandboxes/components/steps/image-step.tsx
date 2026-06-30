import { SectionLabel } from "@/components/ui/section-label";

import { ListSkeleton } from "../../../../components/list-skeleton.js";
import type { TemplateView } from "../../../../types.js";
import { CardList } from "../card-list.js";
import { StepHeader } from "../step-header.js";
import { CustomImageCard } from "./custom-image-card.js";
import { HarnessCard } from "./harness-card.js";
import { WorkloadCard } from "./workload-card.js";

interface Props {
  templates: TemplateView[];
  loading: boolean;
  selectedTemplateId: string | null;
  customImage: string;
  onPickTemplate: (templateId: string) => void;
  onCustomImageChange: (value: string) => void;
  onContinue: () => void;
}

export function ImageStep({
  templates,
  loading,
  selectedTemplateId,
  customImage,
  onPickTemplate,
  onCustomImageChange,
  onContinue,
}: Props) {
  const harnessImages = templates.filter((t) => t.category === "harness");
  const preconfiguredImages = templates.filter(
    (t) => t.category === "preconfigured",
  );
  return (
    <div>
      <StepHeader
        step={1}
        title="Choose your starting point"
        subtitle="Every sandbox boots from an image. Start with a coding agent, a pre-configured framework, or bring your own."
      />

      <section className="mb-8">
        <SectionLabel spaced>Coding agents</SectionLabel>
        <CardList>
          {loading ? (
            <ListSkeleton rows={4} rowHeight={64} />
          ) : (
            harnessImages.map((template) => (
              <HarnessCard
                key={template.id}
                template={template}
                selected={template.id === selectedTemplateId}
                onSelect={() => onPickTemplate(template.id)}
              />
            ))
          )}
        </CardList>
      </section>

      <section className="mb-8">
        <SectionLabel spaced>Custom images</SectionLabel>
        <CardList>
          <CustomImageCard
            value={customImage}
            selected={customImage.trim().length > 0}
            onChange={onCustomImageChange}
            onSubmit={onContinue}
          />
        </CardList>
      </section>

      {!loading && preconfiguredImages.length > 0 && (
        <section className="mb-8">
          <SectionLabel spaced>Pre-configured images</SectionLabel>
          <CardList>
            {preconfiguredImages.map((template) => (
              <WorkloadCard
                key={template.id}
                template={template}
                selected={template.id === selectedTemplateId}
                onSelect={() => onPickTemplate(template.id)}
              />
            ))}
          </CardList>
        </section>
      )}
    </div>
  );
}
