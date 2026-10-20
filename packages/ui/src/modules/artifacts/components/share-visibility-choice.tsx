import { type CarbonIconType, Earth, Link, Locked } from "@carbon/icons-react";
import {
  type ArtifactVisibility,
  artifactVisibilitySchema,
} from "api-server-api";

import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

interface Props {
  value: ArtifactVisibility;
  onChange: (value: ArtifactVisibility) => void;
  disabled: boolean;
  unavailable?: Partial<Record<ArtifactVisibility, string>>;
}

export const VISIBILITY_OPTIONS: Record<
  ArtifactVisibility,
  { label: string; description: string; Icon: CarbonIconType }
> = {
  private: { label: "Private", description: "Only you", Icon: Locked },
  restricted: {
    label: "Restricted",
    description: "Only invited people",
    Icon: Link,
  },
  public: {
    label: "Public",
    description: "Anyone with the link",
    Icon: Earth,
  },
};

export function ShareVisibilityChoice({
  value,
  onChange,
  disabled,
  unavailable = {},
}: Props) {
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
      {artifactVisibilitySchema.options.map((visibility) => {
        const { label, description, Icon } = VISIBILITY_OPTIONS[visibility];
        const unavailableReason = unavailable[visibility];
        return (
          <div key={visibility} className="flex flex-col gap-1">
            <RadioGroupItem
              value={visibility}
              label={label}
              labelSuffix={
                <Icon
                  size={14}
                  className="ml-1.5 inline align-[-2px] text-muted-foreground"
                />
              }
              description={unavailableReason ?? description}
              disabled={unavailableReason !== undefined}
              testId={`share-visibility-${visibility}`}
              className="rounded-lg p-2 enabled:cursor-pointer enabled:hover:bg-muted/40"
            />
          </div>
        );
      })}
    </RadioGroup>
  );
}
