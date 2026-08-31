import { Chemistry } from "@carbon/icons-react";

import { SectionLabel } from "@/components/ui/section-label";

import type { TemplateView } from "../../../types.js";
import { CardGrid } from "../../sandboxes/components/card-list.js";
import {
  CardIconTile,
  StackedCard,
} from "../../sandboxes/components/steps/stacked-card.js";

interface Props {
  frameworks: TemplateView[];
  loading: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function FrameworkSection({
  frameworks,
  loading,
  selectedId,
  onSelect,
}: Props) {
  return (
    <section className="mb-8">
      <SectionLabel spaced>Framework</SectionLabel>
      {loading ? (
        <div className="h-[76px] animate-pulse rounded-lg bg-muted" />
      ) : (
        <CardGrid>
          {frameworks.map((fw) => (
            <StackedCard
              key={fw.id}
              icon={<CardIconTile icon={Chemistry} />}
              title={fw.name}
              description={fw.description ?? ""}
              selected={selectedId === fw.id}
              onSelect={() => onSelect(fw.id)}
              testId={`framework-card-${fw.id}`}
            />
          ))}
        </CardGrid>
      )}
    </section>
  );
}
