import { WarningAlt } from "@carbon/icons-react";

import { RadioGroup, RadioGroupCard } from "@/components/ui/radio-group";

import {
  type ConnectionAccess,
  FULL_ACCESS_DESCRIPTION,
  FULL_ACCESS_WARNING,
  READ_ONLY_DESCRIPTION,
  READ_ONLY_LABEL,
} from "../lib/access-choice.js";

interface Props {
  value: ConnectionAccess;
  onChange: (value: ConnectionAccess) => void;
  fullAccessLabel: string;
  testIdPrefix: string;
}

// UNIT_BOUNDARY_DESCRIPTION: the one place the owner chooses whether a connection only reads or also acts as them, for a template that offers the choice, such as a Slack Account. Read only is the first card and the default; full access is its own card in the danger tone under the template's own label, so acting as the owner is always a choice someone made.
export function AccessChoiceField({
  value,
  onChange,
  fullAccessLabel,
  testIdPrefix,
}: Props) {
  return (
    <RadioGroup
      value={value}
      onValueChange={(next) => onChange(next === "full" ? "full" : "read-only")}
      aria-label="What agents can do with this connection"
      className="gap-3"
    >
      <RadioGroupCard
        value="read-only"
        label={READ_ONLY_LABEL}
        description={READ_ONLY_DESCRIPTION}
        testId={`${testIdPrefix}-read-only`}
      />
      <RadioGroupCard
        value="full"
        tone="danger"
        label={fullAccessLabel}
        description={FULL_ACCESS_DESCRIPTION}
        testId={`${testIdPrefix}-full-access`}
      >
        {value === "full" ? (
          <p className="flex gap-2 text-sm text-danger">
            <WarningAlt size={16} className="mt-0.5 shrink-0" aria-hidden />
            {FULL_ACCESS_WARNING}
          </p>
        ) : null}
      </RadioGroupCard>
    </RadioGroup>
  );
}
