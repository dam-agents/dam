import { WarningAlt } from "@carbon/icons-react";
import type { ReactNode } from "react";

import { RadioGroup, RadioGroupCard } from "@/components/ui/radio-group";

import {
  type FirstConnectionAccess,
  FULL_ACCESS_LABEL,
  LATER_LABEL,
} from "../lib/github-access.js";

interface Props<A extends FirstConnectionAccess> {
  value: A;
  onChange: (value: A) => void;
  narrowedLabel: string;
  fullAccessReach: string;
  laterDescription?: string;
  testIdPrefix: string;
  children: ReactNode;
}

// UNIT_BOUNDARY_DESCRIPTION: the one place a GitHub connection's reach is chosen. Narrowing is the default and holds the caller's account, repository and permission fields; full access is its own card in the danger tone, so nothing ticked never means everything. The first connection of a new sign-in or installation may also be put off, with a card of its own, when the caller gives laterDescription.
export function GithubAccessChoice<A extends FirstConnectionAccess>({
  value,
  onChange,
  narrowedLabel,
  fullAccessReach,
  laterDescription,
  testIdPrefix,
  children,
}: Props<A>) {
  return (
    <RadioGroup
      value={value}
      onValueChange={(next) => onChange(next as A)}
      aria-label="What this connection reaches"
      className="gap-3"
    >
      <RadioGroupCard
        value="narrowed"
        label={narrowedLabel}
        description="Give agents only what they need."
        testId={`${testIdPrefix}-narrowed`}
      >
        {value === "narrowed" ? (
          <div className="flex flex-col gap-4">{children}</div>
        ) : null}
      </RadioGroupCard>
      <RadioGroupCard
        value="full"
        tone="danger"
        label={FULL_ACCESS_LABEL}
        description={`Reaches ${fullAccessReach}.`}
        testId={`${testIdPrefix}-full-access`}
      >
        {value === "full" ? (
          <p className="flex gap-2 text-sm text-danger">
            <WarningAlt size={16} className="mt-0.5 shrink-0" aria-hidden />
            Every agent you add this connection to can use all of it. Narrow it
            instead unless an agent truly needs everything.
          </p>
        ) : null}
      </RadioGroupCard>
      {laterDescription !== undefined && (
        <RadioGroupCard
          value="later"
          label={LATER_LABEL}
          description={laterDescription}
          testId={`${testIdPrefix}-later`}
        />
      )}
    </RadioGroup>
  );
}
