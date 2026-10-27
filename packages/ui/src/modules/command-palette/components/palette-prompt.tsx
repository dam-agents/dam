import { useId, useState } from "react";

import { Input } from "@/components/ui/input";

const IME_PROCESS_KEY = 229;

export function PalettePrompt({
  label,
  initial,
  onSubmit,
}: {
  label: string;
  initial: string;
  onSubmit: (value: string) => void;
}) {
  const id = useId();
  const [value, setValue] = useState(initial);
  return (
    <div className="flex flex-col gap-2 p-4">
      <label htmlFor={id} className="text-sm font-medium text-foreground">
        {label}
      </label>
      <Input
        id={id}
        autoFocus
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onFocus={(event) => event.currentTarget.select()}
        onKeyDown={(event) => {
          if (
            event.key !== "Enter" ||
            event.nativeEvent.isComposing ||
            event.keyCode === IME_PROCESS_KEY
          )
            return;
          event.preventDefault();
          if (value.trim()) onSubmit(value.trim());
        }}
        data-testid="command-palette-prompt"
      />
      <p className="text-xs text-muted-foreground">
        Enter saves, Escape cancels.
      </p>
    </div>
  );
}
