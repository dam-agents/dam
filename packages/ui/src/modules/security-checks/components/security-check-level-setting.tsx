import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { SectionLabel } from "@/components/ui/section-label";

import { getBrand } from "../../../brand.js";
import { useAssistantState } from "../../assistants/api/assistant-state.js";
import { useFeatures } from "../../features/api/queries.js";
import {
  useSecurityCheckLevel,
  useSetSecurityCheckLevel,
} from "../api/queries.js";
import {
  securityCheckLevelIntro,
  securityCheckLevelOptions,
} from "../lib/security-check-levels.js";

/* UNIT_BOUNDARY_DESCRIPTION: the level of the weekly security check, in the General settings of the Agent that runs it. It shows only in the assistant's own settings and only for a person the check is offered to, so every other Agent's settings look as they did. */
export function SecurityCheckLevelSetting({ agentId }: { agentId: string }) {
  const offered = useFeatures().data?.["security-check"] ?? false;
  const assistant = useAssistantState();
  const shown = offered && assistant.data?.agentId === agentId;
  const level = useSecurityCheckLevel(shown);
  const setLevel = useSetSecurityCheckLevel();

  if (!shown || level.data === undefined) return null;

  const brand = getBrand();
  const options = securityCheckLevelOptions(brand);
  const current = setLevel.isPending ? setLevel.variables.level : level.data;

  return (
    <section
      className="mb-8 flex flex-col gap-3"
      data-testid="security-check-level"
    >
      <div>
        <SectionLabel>Security advisory</SectionLabel>
        <p className="mt-1 text-sm text-muted-foreground">
          {securityCheckLevelIntro(brand)}
        </p>
      </div>
      <RadioGroup
        aria-label="Security advisory"
        value={current}
        disabled={setLevel.isPending}
        onValueChange={(value) => {
          const picked = options.find((option) => option.value === value);
          if (picked) setLevel.mutate({ level: picked.value });
        }}
      >
        {options.map((option) => (
          <RadioGroupItem
            key={option.value}
            value={option.value}
            label={option.label}
            description={option.description}
            testId={`security-check-level-${option.value}`}
          />
        ))}
      </RadioGroup>
    </section>
  );
}
