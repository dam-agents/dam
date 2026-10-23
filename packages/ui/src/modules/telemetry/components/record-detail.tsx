import type {
  SpendCallCost,
  TelemetryLog,
  TelemetrySpan,
  TurnDetail,
} from "api-server-api";

import { Badge } from "@/components/ui/badge";
import { labelVariants } from "@/components/ui/label";
import { formatDurationMs } from "@/lib/format-time";
import { cn } from "@/lib/utils";

import { callCostLabel } from "../../spend/lib/amounts-label.js";
import { ESTIMATED_CALL_HELP } from "../../spend/lib/copy.js";
import { placementOf } from "../lib/waterfall.js";

function CallCost({ cost }: { cost: SpendCallCost | undefined }) {
  const text = cost ? callCostLabel(cost) : null;
  if (!cost || !text) return null;
  return (
    <p className="text-xs">
      Cost: <span className="font-mono tabular-nums">{text}</span>
      {cost.estimated && (
        <span className="ml-2 text-2xs text-muted-foreground">
          {ESTIMATED_CALL_HELP}
        </span>
      )}
    </p>
  );
}

function AttributeRows({ attributes }: { attributes: Record<string, string> }) {
  const entries = Object.entries(attributes).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  if (entries.length === 0) {
    return (
      <p className="text-2xs text-muted-foreground">No attributes recorded.</p>
    );
  }
  return (
    <dl className="grid grid-cols-[minmax(0,180px)_1fr] gap-x-4 gap-y-1">
      {entries.map(([key, value]) => (
        <div key={key} className="contents">
          <dt className="truncate font-mono text-2xs text-muted-foreground">
            {key}
          </dt>
          <dd className="break-all font-mono text-2xs">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function RecordDetail({
  log,
  cost,
}: {
  log: TelemetryLog;
  cost: SpendCallCost | undefined;
}) {
  const placement = placementOf(log);
  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-sm font-medium">{log.event}</span>
        <Badge variant="secondary">record</Badge>
        {log.severity !== "" && (
          <span className="font-mono text-xs text-muted-foreground">
            {log.severity}
          </span>
        )}
        <span className="font-mono text-xs text-muted-foreground">
          {log.at}
        </span>
      </div>

      <CallCost cost={cost} />

      <p className="text-2xs text-muted-foreground">
        Position on the timeline: {placement.label}.
      </p>

      <div>
        <p className={cn("mb-1", labelVariants())}>Attributes</p>
        <AttributeRows attributes={log.attributes} />
      </div>

      {log.traceId !== "" && (
        <p className="break-all font-mono text-2xs text-muted-foreground">
          trace {log.traceId}
        </p>
      )}
    </div>
  );
}

export function SpanDetail({
  trace,
  span,
  cost,
}: {
  trace: TurnDetail;
  span: TelemetrySpan;
  cost: SpendCallCost | undefined;
}) {
  const attached = trace.logs.filter((l) => l.attachedTo === span.spanId);
  const failed = span.statusCode.includes("ERROR");
  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-sm font-medium">{span.name}</span>
        <Badge variant={failed ? "danger" : "secondary"}>
          {span.statusCode === "" ? "span" : span.statusCode}
        </Badge>
        <span className="font-mono text-xs text-muted-foreground">
          {formatDurationMs(span.durationMs)}
        </span>
        <span className="font-mono text-xs text-muted-foreground">
          {span.service}
        </span>
      </div>

      <CallCost cost={cost} />

      {span.statusMessage !== "" && (
        <p className="font-mono text-xs text-danger">{span.statusMessage}</p>
      )}

      <div>
        <p className={cn("mb-1", labelVariants())}>Span</p>
        <AttributeRows
          attributes={{
            "span.id": span.spanId,
            ...(span.parentSpanId === ""
              ? {}
              : { "parent.span.id": span.parentSpanId }),
            ...(span.traceId === "" ? {} : { "trace.id": span.traceId }),
            "span.kind": span.kind,
            "started.at": span.startedAt,
            ...(span.invocationId === null
              ? {}
              : { "platform.invocation.id": span.invocationId }),
          }}
        />
      </div>

      <div>
        <p className={cn("mb-1", labelVariants())}>Attributes</p>
        <AttributeRows attributes={span.attributes} />
      </div>

      {attached.length > 0 && (
        <div>
          <p className={cn("mb-1", labelVariants())}>
            Records on this span ({attached.length})
          </p>
          <div className="flex flex-col gap-3">
            {attached.map((log) => (
              <div
                key={`${log.at}-${log.event}`}
                className="rounded-md border border-border p-2"
              >
                <p className="mb-1 font-mono text-2xs">
                  {log.event}
                  <span className="ml-2 text-muted-foreground">{log.at}</span>
                </p>
                <AttributeRows attributes={log.attributes} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
