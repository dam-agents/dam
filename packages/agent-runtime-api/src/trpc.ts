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
  // Lift `cause.upstream` (set by services for upstream gateway errors) into
  // `data.upstream` so tRPC clients can extract `connect_url`/`manage_url`
  // CTAs without the cause being stripped from the wire envelope.
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

// Authentication of the api-server → agent-runtime hop is enforced at the
// kernel by the agent pod's NetworkPolicy: ingress on the ACP/tRPC port is
// admitted only from the api-server pod. The api-server, in turn, verifies
// the user JWT and agent ownership before forwarding. There is no
// additional in-process auth check, so files.* and skills.* mount on the
// same `t.procedure` as everything else; `protectedProcedure` is preserved
// as an alias for callers that import it.
export const protectedProcedure = t.procedure;
