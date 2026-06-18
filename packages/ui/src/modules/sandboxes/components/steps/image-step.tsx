import { ArrowRight } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SectionLabel } from "@/components/ui/section-label";
import { cn } from "@/lib/utils";

import { ListSkeleton } from "../../../../components/list-skeleton.js";
import type { TemplateView } from "../../../../types.js";
import { CardList } from "../card-list.js";
import { StepHeader } from "../step-header.js";

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
  const canContinue =
    selectedTemplateId !== null || customImage.trim().length > 0;
  const harnessImages = templates.filter((t) => t.category === "harness");
  const preconfiguredImages = templates.filter(
    (t) => t.category === "preconfigured",
  );
  return (
    <div>
      <StepHeader
        step={1}
        title="Create a sandbox"
        subtitle="Select an image to get started"
      />

      <section className="mb-8">
        <SectionLabel spaced>Harness Images</SectionLabel>
        <CardList>
          {loading ? (
            <ListSkeleton rows={4} rowHeight={64} />
          ) : (
            harnessImages.map((template) => (
              <ImageCard
                key={template.id}
                name={template.name}
                description={template.description}
                experimental={template.experimental}
                selected={template.id === selectedTemplateId}
                onSelect={() => onPickTemplate(template.id)}
              />
            ))
          )}
        </CardList>
      </section>

      {!loading && preconfiguredImages.length > 0 && (
        <section className="mb-8">
          <SectionLabel spaced>Pre-configured Images</SectionLabel>
          <CardList>
            {preconfiguredImages.map((template) => (
              <ImageCard
                key={template.id}
                name={template.name}
                description={template.description}
                experimental={template.experimental}
                selected={template.id === selectedTemplateId}
                onSelect={() => onPickTemplate(template.id)}
              />
            ))}
          </CardList>
        </section>
      )}

      <section className="mb-8">
        <SectionLabel spaced>Custom Image</SectionLabel>
        <CardList>
          <CustomImageCard
            value={customImage}
            selected={customImage.trim().length > 0}
            onChange={onCustomImageChange}
            onSubmit={() => {
              if (canContinue) onContinue();
            }}
          />
        </CardList>
      </section>

      <div className="flex justify-end">
        <Button onClick={onContinue} disabled={!canContinue}>
          Continue <ArrowRight size={16} />
        </Button>
      </div>
    </div>
  );
}

function ImageCard({
  name,
  description,
  experimental,
  selected,
  onSelect,
}: {
  name: string;
  description?: string;
  experimental?: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        "w-full rounded-lg border p-4 text-left transition-colors",
        selected
          ? "border-foreground bg-muted/60"
          : "border-border bg-card hover:bg-muted/40",
      )}
    >
      <div className="flex items-center gap-2">
        <p className="text-[16px] font-semibold text-foreground">{name}</p>
        {experimental && (
          <Badge
            variant="outline"
            className="border-transparent bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300"
          >
            Alpha
          </Badge>
        )}
      </div>
      {description && (
        <p className="mt-1 text-[14px] text-muted-foreground">{description}</p>
      )}
    </button>
  );
}

function CustomImageCard({
  value,
  selected,
  onChange,
  onSubmit,
}: {
  value: string;
  selected: boolean;
  onChange: (value: string) => void;
  onSubmit: () => void;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border px-4 py-4",
        selected ? "border-foreground" : "border-border",
      )}
    >
      <div className="flex items-center gap-2">
        <p className="text-[16px] font-semibold text-foreground">Custom</p>
        <Badge
          variant="outline"
          className="border-transparent bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300"
        >
          Advanced
        </Badge>
      </div>
      <p className="mt-1 text-[14px] text-muted-foreground">
        Bring your own ACP-compatible image
      </p>
      <div className="mt-3">
        <Input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") onSubmit();
          }}
          placeholder="ghcr.io/org/agent:latest"
          variant="monospace"
        />
      </div>
    </div>
  );
}
