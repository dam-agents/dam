import type { TimelineSpan, TurnDetail } from "api-server-api";

import { Badge } from "@/components/ui/badge";

import { formatDurationMs } from "../../metrics/lib/format.js";

function AttributeRows({ attributes }: { attributes: Record<string, string> }) {
  const entries = Object.entries(attributes).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  if (entries.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">No attributes recorded.</p>
    );
  }
  return (
    <dl className="grid grid-cols-[minmax(0,200px)_1fr] gap-x-4 gap-y-1">
      {entries.map(([key, value]) => (
        <div key={key} className="contents">
          <dt className="truncate font-mono text-[11px] text-muted-foreground">
            {key}
          </dt>
          <dd className="break-all font-mono text-[11px]">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function SpanDetail({
  trace,
  span,
}: {
  trace: TurnDetail;
  span: TimelineSpan;
}) {
  const attached = trace.logs.filter((l) => l.attachedTo === span.spanId);
  const failed = span.statusCode.includes("ERROR");
  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-sm font-medium">{span.name}</span>
        <Badge variant={failed ? "destructive" : "secondary"}>
          {span.statusCode === "" ? "unset" : span.statusCode}
        </Badge>
        <span className="font-mono text-xs text-muted-foreground">
          {formatDurationMs(span.durationMs)}
        </span>
        <span className="font-mono text-xs text-muted-foreground">
          {span.service}
        </span>
      </div>

      {span.statusMessage !== "" && (
        <p className="font-mono text-xs text-destructive">
          {span.statusMessage}
        </p>
      )}

      <div>
        <p className="mb-1 text-[11px] uppercase tracking-wide text-muted-foreground">
          Span
        </p>
        <AttributeRows
          attributes={{
            "span.id": span.spanId,
            ...(span.parentSpanId === ""
              ? {}
              : { "parent.span.id": span.parentSpanId }),
            "span.kind": span.kind,
            "started.at": span.startedAt,
            ...(span.invocationId === null
              ? {}
              : { "platform.invocation.id": span.invocationId }),
          }}
        />
      </div>

      <div>
        <p className="mb-1 text-[11px] uppercase tracking-wide text-muted-foreground">
          Attributes
        </p>
        <AttributeRows attributes={span.attributes} />
      </div>

      {attached.length > 0 && (
        <div>
          <p className="mb-1 text-[11px] uppercase tracking-wide text-muted-foreground">
            Log records on this span ({attached.length})
          </p>
          <div className="flex flex-col gap-3">
            {attached.map((log) => (
              <div
                key={`${log.at}-${log.event}`}
                className="rounded-md border border-border p-2"
              >
                <p className="mb-1 font-mono text-[11px]">
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
