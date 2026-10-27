import { Callout } from "@/components/ui/callout";
import { SectionLabel } from "@/components/ui/section-label";

import type { TemplateView } from "../../../../types.js";
import { CardList } from "../card-list.js";
import {
  CustomImageCard,
  type RegistryControls,
} from "../steps/custom-image-card.js";
import { HarnessGrid } from "./harness-grid.js";

interface Props {
  harnesses: TemplateView[];
  loading: boolean;
  error: boolean;
  onRetry: () => void;
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
  error,
  onRetry,
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
      <HarnessGrid
        harnesses={harnesses}
        loading={loading}
        error={error}
        onRetry={onRetry}
        templateId={templateId}
        onPick={onPickTemplate}
      />

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
