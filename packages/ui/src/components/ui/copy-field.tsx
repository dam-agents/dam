import { CopyButton } from "@/components/ui/copy-button";
import { Input } from "@/components/ui/input";
import type { CopyState } from "@/hooks/use-copy";

/**
 * UNIT_BOUNDARY_DESCRIPTION: A read-only value the user takes elsewhere, such
 * as a share or invitation link: a field that selects its text on focus, with
 * a copy button beside it.
 */
export function CopyField({
  value,
  label,
  onResult,
}: {
  value: string;
  label: string;
  onResult?: (state: CopyState) => void;
}) {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <Input
        readOnly
        aria-label={label}
        value={value}
        size="sm"
        variant="monospace"
        onFocus={(e) => e.currentTarget.select()}
      />
      <CopyButton
        value={value}
        label={`Copy ${label.toLowerCase()}`}
        variant="outline"
        size="icon-sm"
        onResult={onResult}
      />
    </div>
  );
}
