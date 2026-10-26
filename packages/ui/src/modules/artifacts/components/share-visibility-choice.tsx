import {
  type ArtifactVisibility,
  artifactVisibilitySchema,
} from "api-server-api";

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
  { value: "private", label: "Private", description: "Only you" },
  {
    value: "restricted",
    label: "Restricted",
    description: "Only invited people",
  },
  { value: "public", label: "Public", description: "Anyone with the link" },
];

export function ShareVisibilityChoice({ value, onChange, disabled }: Props) {
  return (
    <RadioGroup
      aria-label="Who can open this artifact"
      value={value}
      disabled={disabled}
      onValueChange={(next) => {
        const parsed = artifactVisibilitySchema.safeParse(next);
        if (parsed.success) onChange(parsed.data);
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
        </div>
      ))}
    </RadioGroup>
  );
}
