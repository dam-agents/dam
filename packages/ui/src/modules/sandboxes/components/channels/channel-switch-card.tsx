import type { ReactNode } from "react";

import { Switch } from "@/components/ui/switch";
import { ToggleRow } from "@/components/ui/toggle-row";

interface Props {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
  children: ReactNode;
}

export function ChannelSwitchCard({
  label,
  checked,
  onChange,
  disabled,
  children,
}: Props) {
  return (
    <ToggleRow
      className="w-full gap-3 rounded-md border border-border bg-background px-3 py-2.5"
      title={label}
      description={children}
      control={
        <Switch
          className="mt-0.5"
          disabled={disabled}
          checked={checked}
          onCheckedChange={onChange}
          label={label}
        />
      }
    />
  );
}
