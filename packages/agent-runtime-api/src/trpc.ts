import { initTRPC } from "@trpc/server";
import type { AgentRuntimeContext } from "./context.js";

interface UpstreamCause {
  upstream?: { status: number; body: unknown };
}

function extractUpstream(
  cause: unknown,
): UpstreamCause["upstream"] | undefined {
  if (cause && typeof cause === "object" && "upstream" in cause) {
    const u = (cause as UpstreamCause).upstream;
    if (u && typeof u === "object" && typeof u.status === "number") return u;
  }
  return undefined;
}

export const t = initTRPC.context<AgentRuntimeContext>().create({
  errorFormatter: ({ shape, error }) => {
    const upstream = extractUpstream(error.cause);
    return {
      ...shape,
      data: {
        ...shape.data,
        ...(upstream ? { upstream } : {}),
      },
    };
  },
});

export const protectedProcedure = t.procedure;
