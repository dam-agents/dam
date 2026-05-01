import { TRPCError } from "@trpc/server";
import { protectedProcedure, t } from "../../trpc.js";
import {
  installSkillInput,
  listLocalSkillsInput,
  publishSkillInput,
  readLocalSkillInput,
  scanSkillSourceInput,
  uninstallSkillInput,
  type SkillsDomainError,
} from "./types.js";

function toTrpcError(error: SkillsDomainError): TRPCError {
  switch (error.kind) {
    case "InvalidSkillName":
      return new TRPCError({ code: "BAD_REQUEST", message: `invalid skill name: ${error.reason}` });
    case "InvalidSkillPath":
      return new TRPCError({ code: "BAD_REQUEST", message: `invalid skill path: ${error.reason}` });
    case "SkillNotFound":
      return new TRPCError({ code: "NOT_FOUND", message: `skill ${JSON.stringify(error.name)} not found` });
    case "SkillNotFoundInSource":
      return new TRPCError({
        code: "NOT_FOUND",
        message: `skill ${JSON.stringify(error.name)} not found in source ${error.source}`,
      });
    case "PayloadTooLarge":
      return new TRPCError({ code: "PAYLOAD_TOO_LARGE", message: error.detail });
    case "SourceFetchFailed":
      return new TRPCError({
        code: "BAD_GATEWAY",
        message: `failed to fetch source ${error.source}: ${error.detail}`,
      });
    case "UpstreamGitHubError":
      return new TRPCError({
        code: "BAD_GATEWAY",
        message: `github ${error.method} ${error.path} → ${error.status}: ${error.body.message ?? error.body.error ?? "upstream error"}`,
        cause: { upstream: { status: error.status, body: error.body } },
      });
  }
}

export const skillsRouter = t.router({
  install: protectedProcedure
    .input(installSkillInput)
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.skills.install(input);
      if (!result.ok) throw toTrpcError(result.error);
      return result.value;
    }),

  uninstall: protectedProcedure
    .input(uninstallSkillInput)
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.skills.uninstall(input);
      if (!result.ok) throw toTrpcError(result.error);
      return { ok: true as const };
    }),

  scan: protectedProcedure
    .input(scanSkillSourceInput)
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.skills.scan(input);
      if (!result.ok) throw toTrpcError(result.error);
      return { skills: result.value };
    }),

  publish: protectedProcedure
    .input(publishSkillInput)
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.skills.publish(input);
      if (!result.ok) throw toTrpcError(result.error);
      return result.value;
    }),

  listLocal: protectedProcedure
    .input(listLocalSkillsInput)
    .query(async ({ ctx, input }) => {
      const result = await ctx.skills.listLocal(input);
      if (!result.ok) throw toTrpcError(result.error);
      return { skills: result.value };
    }),

  readLocal: protectedProcedure
    .input(readLocalSkillInput)
    .query(async ({ ctx, input }) => {
      const result = await ctx.skills.readLocal(input);
      if (!result.ok) throw toTrpcError(result.error);
      return result.value;
    }),
});
