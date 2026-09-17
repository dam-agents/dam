import { Search } from "@carbon/icons-react";

import { Input } from "@/components/ui/input";

interface Props {
  value: string;
  onChange: (value: string) => void;
}

export function PickerSearch({ value, onChange }: Props) {
  return (
    <div className="relative mt-6">
      <Search
        size={16}
        className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground"
      />
      <Input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Search agents…"
        aria-label="Search agents"
        className="pl-9"
      />
    </div>
  );
}
