import { TrashCan } from "@carbon/icons-react";
import { useFormContext } from "react-hook-form";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

import type { ExperimentWizardValues } from "../../forms/experiment-wizard-schema.js";
import { armColor } from "../../lib/arm-color.js";

interface Props {
  index: number;
  agentId: string;
  agentName: string;
  templateName: string | null;
  onRemove: () => void;
}

export function ArmFieldCard({
  index,
  agentId,
  agentName,
  templateName,
  onRemove,
}: Props) {
  const {
    register,
    formState: { errors },
  } = useFormContext<ExperimentWizardValues>();
  const error = errors.arms?.[index]?.variation;

  return (
    <div className="rounded-lg border border-border p-3">
      <div className="flex items-center gap-2.5">
        <span
          className="h-2.5 w-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: armColor(agentId) }}
        />
        <span className="truncate font-medium text-foreground">
          {agentName}
        </span>
        {templateName && (
          <span className="rounded-md border border-border bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
            {templateName}
          </span>
        )}
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          tone="danger"
          className="ml-auto"
          aria-label={`Remove ${agentName}`}
          onClick={onRemove}
        >
          <TrashCan size={15} />
        </Button>
      </div>
      <Textarea
        spellCheck={false}
        aria-label={`${agentName} variation`}
        placeholder="Optional. What sets this arm apart — appended to the shared prompt as free text."
        className={cn(
          "mt-2 min-h-[72px] font-mono text-[12.5px]",
          error && "border-destructive focus-visible:ring-destructive",
        )}
        {...register(`arms.${index}.variation`)}
      />
      {error && (
        <p className="mt-1 text-[12px] text-destructive">{error.message}</p>
      )}
    </div>
  );
}
