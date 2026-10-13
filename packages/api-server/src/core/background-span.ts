import {
  context,
  trace,
  SpanKind,
  SpanStatusCode,
  type Attributes,
  type Link,
} from "@opentelemetry/api";

const SCOPE = "platform-apiserver";

/**
 * UNIT_BOUNDARY_DESCRIPTION: traces one unit of background work — a schedule
 * fire, a channel turn — as a trace of its own. The work outlives whatever
 * started it, so it opens a new root and links to the caller's span instead of
 * nesting under it. Attributes must come from a bounded set and never name a
 * person, an agent or anything user-authored; a failure records only its
 * error type, since an error message is free text.
 */
export async function inBackgroundSpan<T>(
  name: string,
  attributes: Attributes,
  work: () => Promise<T>,
): Promise<T> {
  const caller = trace.getActiveSpan()?.spanContext();
  const links: Link[] =
    caller && trace.isSpanContextValid(caller) ? [{ context: caller }] : [];
  return trace
    .getTracer(SCOPE)
    .startActiveSpan(
      name,
      { kind: SpanKind.INTERNAL, root: true, attributes, links },
      context.active(),
      async (span) => {
        try {
          return await work();
        } catch (err) {
          span.setStatus({ code: SpanStatusCode.ERROR });
          span.setAttribute(
            "error.type",
            err instanceof Error ? err.name : "unknown",
          );
          throw err;
        } finally {
          span.end();
        }
      },
    );
}

export function annotateSpan(attributes: Attributes): void {
  trace.getActiveSpan()?.setAttributes(attributes);
}
