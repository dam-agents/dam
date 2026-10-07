import { TRPCError } from "@trpc/server";
import { t } from "../../trpc.js";
import { browserNavigateInputSchema } from "./schemas.js";
import type { BrowserAction, BrowserDomainError } from "./types.js";

function toTrpcError(error: BrowserDomainError): TRPCError {
  switch (error.kind) {
    case "NotOffered":
      return new TRPCError({
        code: "FORBIDDEN",
        message:
          "The browser panel is offered only on agents that require named connections",
      });
    case "NoDisplay":
      return new TRPCError({
        code: "PRECONDITION_FAILED",
        message:
          "This agent's image cannot show its browser: it has no virtual display or stream server",
      });
    case "NotWebAddress":
      return new TRPCError({
        code: "BAD_REQUEST",
        message: "Only http and https addresses open",
      });
    case "Failed":
      return new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: error.detail,
      });
  }
}

const action = (name: BrowserAction) =>
  t.procedure.mutation(async ({ ctx }) => {
    const result = await ctx.browser.act(name);
    if (!result.ok) throw toTrpcError(result.error);
  });

export const browserRouter = t.router({
  watch: t.procedure.subscription(async function* ({ ctx, signal }) {
    const result = ctx.browser.watch(signal);
    if (!result.ok) throw toTrpcError(result.error);
    for await (const snapshot of result.value) yield snapshot;
  }),
  navigate: t.procedure
    .input(browserNavigateInputSchema)
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.browser.navigate(input.url);
      if (!result.ok) throw toTrpcError(result.error);
    }),
  reload: action("reload"),
  stop: action("stop"),
  back: action("back"),
  forward: action("forward"),
  restart: action("restart"),
  clearData: action("clearData"),
});
