import { Fragment } from "react";

import type { ActionPayload } from "../lib/prompts.js";

function formatValue(value: unknown): string {
  if (Array.isArray(value)) return value.length > 0 ? value.join(", ") : "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

interface Props {
  action: ActionPayload;
}

export function A2uiActionSummary({ action }: Props) {
  const entries = Object.entries(action.context);
  return (
    <div data-testid="a2ui-action-summary" className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">
        {action.userMessage ?? `Form sent · ${action.name}`}
      </span>
      {entries.length > 0 && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
          {entries.map(([key, value]) => (
            <Fragment key={key}>
              <dt className="text-muted-foreground">{key}</dt>
              <dd className="break-words">{formatValue(value)}</dd>
            </Fragment>
          ))}
        </dl>
      )}
    </div>
  );
}
