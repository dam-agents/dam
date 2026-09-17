import type { ReactNode } from "react";

import { Switch } from "@/components/ui/switch";

interface Props {
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
  children: ReactNode;
}

export function AmbientModeCard({
  checked,
  onChange,
  disabled,
  children,
}: Props) {
  return (
    <div className="flex w-full items-start justify-between gap-3 rounded-md border border-border bg-background px-3 py-2.5">
      <span className="flex flex-col gap-0.5">
        <span className="text-sm font-medium text-foreground">
          Ambient mode
        </span>
        <span className="text-sm text-muted-foreground">{children}</span>
      </span>
      <Switch
        className="mt-0.5"
        disabled={disabled}
        checked={checked}
        onCheckedChange={onChange}
        label="Ambient mode"
      />
    </div>
  );
}
