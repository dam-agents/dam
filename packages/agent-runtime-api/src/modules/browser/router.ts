import { TRPCError } from "@trpc/server";
import { t } from "../../trpc.js";
import {
  browserActionInputSchema,
  browserNavigateInputSchema,
  browserTabInputSchema,
  browserTestingModeInputSchema,
} from "./schemas.js";
import type { BrowserAction, BrowserDomainError, TabAction } from "./types.js";

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
    case "TabGone":
      return new TRPCError({
        code: "NOT_FOUND",
        message: "That tab is closed",
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

const tabAction = (name: TabAction) =>
  t.procedure
    .input(browserActionInputSchema)
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.browser.act(name, input?.tab);
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
      const result = await ctx.browser.navigate(input.url, input.tab);
      if (!result.ok) throw toTrpcError(result.error);
    }),
  reload: tabAction("reload"),
  stop: tabAction("stop"),
  back: tabAction("back"),
  forward: tabAction("forward"),
  selectTab: t.procedure
    .input(browserTabInputSchema)
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.browser.selectTab(input.tab);
      if (!result.ok) throw toTrpcError(result.error);
    }),
  newTab: t.procedure.mutation(async ({ ctx }) => {
    const result = await ctx.browser.newTab();
    if (!result.ok) throw toTrpcError(result.error);
    return { tab: result.value };
  }),
  closeTab: t.procedure
    .input(browserTabInputSchema)
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.browser.closeTab(input.tab);
      if (!result.ok) throw toTrpcError(result.error);
    }),
  restart: action("restart"),
  clearData: action("clearData"),
  setTestingMode: t.procedure
    .input(browserTestingModeInputSchema)
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.browser.setTestingMode(input.on);
      if (!result.ok) throw toTrpcError(result.error);
    }),
});
