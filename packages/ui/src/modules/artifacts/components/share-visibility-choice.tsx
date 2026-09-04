import type { ArtifactVisibility } from "api-server-api";
import type { ReactNode } from "react";

import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

interface Props {
  value: ArtifactVisibility;
  onChange: (value: ArtifactVisibility) => void;
  disabled: boolean;
  restrictedPanel: ReactNode;
}

const OPTIONS: {
  value: ArtifactVisibility;
  label: string;
  description: string;
}[] = [
  { value: "private", label: "Private", description: "Only you" },
  {
    value: "restricted",
    label: "Restricted",
    description: "Only invited people",
  },
  { value: "public", label: "Public", description: "Anyone with the link" },
];

function isVisibility(value: string): value is ArtifactVisibility {
  return OPTIONS.some((option) => option.value === value);
}

export function ShareVisibilityChoice({
  value,
  onChange,
  disabled,
  restrictedPanel,
}: Props) {
  return (
    <RadioGroup
      aria-label="Who can open this artifact"
      value={value}
      disabled={disabled}
      onValueChange={(next) => {
        if (isVisibility(next)) onChange(next);
      }}
    >
      {OPTIONS.map((option) => (
        <div key={option.value} className="flex flex-col gap-1">
          <RadioGroupItem
            value={option.value}
            label={option.label}
            description={option.description}
            testId={`share-visibility-${option.value}`}
            className="rounded-lg p-2 enabled:cursor-pointer enabled:hover:bg-muted/40"
          />
          {option.value === "restricted" && value === "restricted" && (
            <div className="pb-1 pl-[34px] pr-2">{restrictedPanel}</div>
          )}
        </div>
      ))}
    </RadioGroup>
  );
}
