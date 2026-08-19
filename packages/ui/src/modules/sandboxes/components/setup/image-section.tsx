import { Callout } from "@/components/ui/callout";
import { SectionLabel } from "@/components/ui/section-label";

import { ListSkeleton } from "../../../../components/list-skeleton.js";
import type { TemplateView } from "../../../../types.js";
import { CardGrid, CardList } from "../card-list.js";
import {
  CustomImageCard,
  type RegistryControls,
} from "../steps/custom-image-card.js";
import { HarnessCard } from "../steps/harness-card.js";

interface Props {
  harnesses: TemplateView[];
  loading: boolean;
  templateId: string | null;
  customImage: string;
  registry: RegistryControls;
  onPickTemplate: (templateId: string) => void;
  onCustomImageChange: (value: string) => void;
  onSubmit: () => void;
}

export function ImageSection({
  harnesses,
  loading,
  templateId,
  customImage,
  registry,
  onPickTemplate,
  onCustomImageChange,
  onSubmit,
}: Props) {
  const setupNote = harnesses.find((t) => t.id === templateId)?.setupNote;

  return (
    <section className="mb-8">
      <SectionLabel spaced>Image</SectionLabel>
      {loading ? (
        <CardList>
          <ListSkeleton rows={2} rowHeight={156} />
        </CardList>
      ) : (
        <CardGrid>
          {harnesses.map((template) => (
            <HarnessCard
              key={template.id}
              template={template}
              selected={template.id === templateId}
              onSelect={() => onPickTemplate(template.id)}
            />
          ))}
        </CardGrid>
      )}

      {setupNote && (
        <Callout tone="info" inset className="mt-3">
          <p className="text-sm font-semibold text-foreground">
            {setupNote.title}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">{setupNote.body}</p>
        </Callout>
      )}

      <div className="my-6 flex items-center gap-3">
        <span className="h-px flex-1 bg-border" />
        <span className="text-sm text-muted-foreground">
          or use a custom image
        </span>
        <span className="h-px flex-1 bg-border" />
      </div>

      <CardList>
        <CustomImageCard
          value={customImage}
          selected={customImage.trim().length > 0}
          onChange={onCustomImageChange}
          onSubmit={onSubmit}
          registry={customImage.trim().length > 0 ? registry : undefined}
        />
      </CardList>
    </section>
  );
}
