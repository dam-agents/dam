import { useId, useState } from "react";

import { Input } from "@/components/ui/input";

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
  const trimmed = value.trim();
  return (
    <form
      className="flex flex-col gap-2 p-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (trimmed) onSubmit(trimmed);
      }}
    >
      <label htmlFor={id} className="text-sm font-medium text-foreground">
        {label}
      </label>
      <Input
        id={id}
        autoFocus
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onFocus={(event) => event.currentTarget.select()}
        data-testid="command-palette-prompt"
      />
      <p className="text-xs text-muted-foreground">
        Enter saves, Escape cancels.
      </p>
    </form>
  );
}
