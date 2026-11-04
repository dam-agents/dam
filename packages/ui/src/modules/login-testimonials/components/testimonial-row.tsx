import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { LIST_ROW } from "@/components/ui/list-section";
import { RowActionsMenu } from "@/components/ui/row-actions-menu";

import type { DraftTestimonial } from "../lib/draft.js";
import { TestimonialPhoto } from "./testimonial-photo.js";

export function TestimonialRow({
  testimonial,
  first,
  last,
  disabled,
  onEdit,
  onMove,
  onRemove,
}: {
  testimonial: DraftTestimonial;
  first: boolean;
  last: boolean;
  disabled: boolean;
  onEdit: () => void;
  onMove: (by: -1 | 1) => void;
  onRemove: () => void;
}) {
  const { name, role, quote, photoId } = testimonial;
  return (
    <div className={LIST_ROW}>
      <TestimonialPhoto name={name} photoId={photoId} />
      <div className="min-w-0 flex-1">
        <p className="text-md font-medium text-foreground">
          {name}
          {role && (
            <span className="font-normal text-muted-foreground"> · {role}</span>
          )}
        </p>
        <p className="mt-0.5 truncate text-sm text-muted-foreground">{quote}</p>
      </div>
      <RowActionsMenu label={`Actions for ${name}`} disabled={disabled}>
        <DropdownMenuItem onSelect={onEdit}>Edit</DropdownMenuItem>
        <DropdownMenuItem disabled={first} onSelect={() => onMove(-1)}>
          Move up
        </DropdownMenuItem>
        <DropdownMenuItem disabled={last} onSelect={() => onMove(1)}>
          Move down
        </DropdownMenuItem>
        <DropdownMenuItem tone="danger" onSelect={onRemove}>
          Remove
        </DropdownMenuItem>
      </RowActionsMenu>
    </div>
  );
}
