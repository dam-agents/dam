import { Button } from "@/components/ui/button";

import { PICKER_WIDTH } from "./bind-page.js";

interface Props {
  consent: string;
  action: string;
  enabled: boolean;
  pending: boolean;
  onConfirm: () => void;
}

export function PickerFooter({
  consent,
  action,
  enabled,
  pending,
  onConfirm,
}: Props) {
  return (
    <div className="sticky bottom-0 border-t border-border bg-background px-6 py-4">
      <div
        className={`mx-auto flex w-full items-center justify-between gap-8 ${PICKER_WIDTH}`}
      >
        <p className="text-xs text-muted-foreground">{consent}</p>
        <Button
          disabled={!enabled || pending}
          onClick={onConfirm}
          tooltip={enabled ? undefined : "Pick an agent first"}
        >
          {pending ? "Connecting…" : action}
        </Button>
      </div>
    </div>
  );
}
