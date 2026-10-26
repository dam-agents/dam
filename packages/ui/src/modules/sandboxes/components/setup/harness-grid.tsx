import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";

import { ListSkeleton } from "../../../../components/list-skeleton.js";
import type { TemplateView } from "../../../../types.js";
import { CardGrid, CardList } from "../card-list.js";
import { HarnessCard } from "../steps/harness-card.js";

interface Props {
  harnesses: TemplateView[];
  loading: boolean;
  error: boolean;
  onRetry: () => void;
  templateId: string | null;
  onPick: (templateId: string) => void;
}

export function HarnessGrid({
  harnesses,
  loading,
  error,
  onRetry,
  templateId,
  onPick,
}: Props) {
  if (loading) {
    return (
      <CardList>
        <ListSkeleton rows={2} rowHeight={156} />
      </CardList>
    );
  }
  if (error) {
    return (
      <Callout tone="danger" inset>
        <p className="text-sm text-foreground">
          Couldn't load the harness catalogue.
        </p>
        <Button variant="outline" size="sm" className="mt-2" onClick={onRetry}>
          Retry
        </Button>
      </Callout>
    );
  }
  if (harnesses.length === 0) {
    return (
      <Callout tone="info" inset>
        <p className="text-sm text-foreground">
          No harness is available on this installation.
        </p>
      </Callout>
    );
  }
  return (
    <CardGrid>
      {harnesses.map((template) => (
        <HarnessCard
          key={template.id}
          template={template}
          selected={template.id === templateId}
          onSelect={() => onPick(template.id)}
        />
      ))}
    </CardGrid>
  );
}
