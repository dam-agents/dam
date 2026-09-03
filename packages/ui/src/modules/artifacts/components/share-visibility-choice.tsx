import type { ArtifactVisibility } from "api-server-api";

import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

interface Props {
  value: ArtifactVisibility;
  onChange: (value: ArtifactVisibility) => void;
  disabled: boolean;
}

const OPTIONS: {
  value: ArtifactVisibility;
  label: string;
  description: string;
}[] = [
  { value: "private", label: "Private", description: "Only you, in the app." },
  {
    value: "restricted",
    label: "Restricted",
    description:
      "Only people you name. They sign in with their company account.",
  },
  {
    value: "public",
    label: "Public link",
    description: "Anyone with the link. No account needed.",
  },
];

function isVisibility(value: string): value is ArtifactVisibility {
  return OPTIONS.some((option) => option.value === value);
}

export function ShareVisibilityChoice({ value, onChange, disabled }: Props) {
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
        <RadioGroupItem
          key={option.value}
          value={option.value}
          label={option.label}
          description={option.description}
          testId={`share-visibility-${option.value}`}
          className="rounded-lg p-2 enabled:cursor-pointer enabled:hover:bg-muted/40"
        />
      ))}
    </RadioGroup>
  );
}
