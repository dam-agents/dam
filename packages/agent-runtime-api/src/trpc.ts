import { initTRPC, TRPCError } from "@trpc/server";
import type { AgentRuntimeContext } from "./context.js";

interface UpstreamCause {
  upstream?: { status: number; body: unknown };
}

function extractUpstream(cause: unknown): UpstreamCause["upstream"] | undefined {
  if (cause && typeof cause === "object" && "upstream" in cause) {
    const u = (cause as UpstreamCause).upstream;
    if (u && typeof u === "object" && typeof u.status === "number") return u;
  }
  return undefined;
}

export const t = initTRPC.context<AgentRuntimeContext>().create({
  // Lift `cause.upstream` (set by services for OneCLI/GitHub gateway errors)
  // into `data.upstream` so tRPC clients can extract `connect_url`/`manage_url`
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

export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.auth?.agentCaller) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return next({ ctx: { ...ctx, auth: ctx.auth } });
});
