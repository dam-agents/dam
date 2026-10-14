import { useA2uiSurface } from "../../contexts/a2ui-surface-context.js";
import { useA2uiBindings } from "../../hooks/use-a2ui-bindings.js";
import type { CheckRule } from "../../lib/schema.js";
import type { CheckFailure } from "../../lib/validation.js";

const SEVERITY_CLASS: Record<CheckFailure["severity"], string> = {
  error: "text-danger",
  warning: "text-warning-fg",
  info: "text-muted-foreground",
};

interface Props {
  componentId: string;
  checks: readonly CheckRule[] | undefined;
}

export function A2uiFieldMessages({ componentId, checks }: Props) {
  const { touched } = useA2uiSurface();
  const failures = useA2uiBindings().checks(checks);
  if (!touched.has(componentId) || failures.length === 0) return null;
  return (
    <ul className="flex flex-col gap-0.5 text-xs" aria-live="polite">
      {failures.map((failure, index) => (
        <li key={index} className={SEVERITY_CLASS[failure.severity]}>
          {failure.message}
        </li>
      ))}
    </ul>
  );
}
