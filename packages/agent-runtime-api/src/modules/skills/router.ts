import { TRPCError } from "@trpc/server";
import { protectedProcedure, t } from "../../trpc.js";
import {
  skillDeleteLocalInputSchema,
  skillPublishInputSchema,
  skillListLocalInputSchema,
  skillReadLocalInputSchema,
  skillReadPullRequestInputSchema,
  skillReadSkillFileInputSchema,
  skillScanInputSchema,
  skillWriteLocalInputSchema,
} from "./schemas.js";
import type { SkillsDomainError, SourcePathReason } from "./types.js";

function toTrpcError(error: SkillsDomainError): TRPCError {
  switch (error.kind) {
    case "InvalidSkillName":
      return new TRPCError({
        code: "BAD_REQUEST",
        message: `invalid skill name: ${error.reason}`,
      });
    case "InvalidSkillPath":
      return new TRPCError({
        code: "BAD_REQUEST",
        message: `invalid skill path: ${error.reason}`,
      });
    case "SkillNotFound":
      return new TRPCError({
        code: "NOT_FOUND",
        message: `skill ${JSON.stringify(error.name)} not found`,
      });
    case "SkillNotFoundInSource":
      return new TRPCError({
        code: "NOT_FOUND",
        message: `skill ${JSON.stringify(error.name)} not found in source ${error.source}`,
      });
    case "SkillAlreadyExists":
      return new TRPCError({
        code: "CONFLICT",
        message: `skill(s) already exist: ${error.names.join(", ")}`,
      });
    case "PayloadTooLarge":
      return new TRPCError({
        code: "PAYLOAD_TOO_LARGE",
        message: error.detail,
      });
    case "SourceFetchFailed":
      return new TRPCError({
        code: "BAD_GATEWAY",
        message: `failed to fetch source ${error.source}: ${error.detail}`,
      });
    case "SourcePathNotFound":
      return new TRPCError({
        code: "BAD_REQUEST",
        message: `source path ${JSON.stringify(error.path)} is not a directory in ${error.source}`,
        cause: {
          sourcePath: {
            reason: "path-missing" satisfies SourcePathReason,
            version: error.version,
          },
        },
      });
    case "SourcePathEmpty":
      return new TRPCError({
        code: "BAD_REQUEST",
        message: `source path ${JSON.stringify(error.path)} holds no skill in ${error.source}`,
        cause: {
          sourcePath: {
            reason: "path-empty" satisfies SourcePathReason,
            version: error.version,
          },
        },
      });
    case "UpstreamGitHubError":
      return new TRPCError({
        code: "BAD_GATEWAY",
        message: `github ${error.method} ${error.path} → ${error.status}: ${error.body.message ?? error.body.error ?? "upstream error"}`,
        cause: { upstream: { status: error.status, body: error.body } },
      });
    case "UpstreamUnreachable":
      return new TRPCError({
        code: "BAD_GATEWAY",
        message: `github ${error.method} ${error.path} unreachable: ${error.detail}`,
        cause: {
          upstream: {
            status: 0,
            body: { error: "upstream_unreachable", message: error.detail },
          },
        },
      });
  }
}

export const skillsRouter = t.router({
  scan: protectedProcedure
    .input(skillScanInputSchema)
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.skills.scan(input);
      if (!result.ok) throw toTrpcError(result.error);
      return { skills: result.value };
    }),

  publish: protectedProcedure
    .input(skillPublishInputSchema)
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.skills.publish(input);
      if (!result.ok) throw toTrpcError(result.error);
      return result.value;
    }),

  listLocal: protectedProcedure
    .input(skillListLocalInputSchema.optional())
    .query(async ({ ctx, input }) => {
      const result = await ctx.skills.listLocal(input);
      if (!result.ok) throw toTrpcError(result.error);
      return { skills: result.value };
    }),

  readLocal: protectedProcedure
    .input(skillReadLocalInputSchema)
    .query(async ({ ctx, input }) => {
      const result = await ctx.skills.readLocal(input);
      if (!result.ok) throw toTrpcError(result.error);
      return result.value;
    }),

  readPullRequest: protectedProcedure
    .input(skillReadPullRequestInputSchema)
    .query(async ({ ctx, input }) => {
      const result = await ctx.skills.readPullRequest(input);
      if (!result.ok) throw toTrpcError(result.error);
      return result.value;
    }),

  readSkillFile: protectedProcedure
    .input(skillReadSkillFileInputSchema)
    .query(async ({ ctx, input }) => {
      const result = await ctx.skills.readSkillFile(input);
      if (!result.ok) throw toTrpcError(result.error);
      return result.value;
    }),

  writeLocal: protectedProcedure
    .input(skillWriteLocalInputSchema)
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.skills.writeLocal(input);
      if (!result.ok) throw toTrpcError(result.error);
      return { skills: result.value };
    }),

  deleteLocal: protectedProcedure
    .input(skillDeleteLocalInputSchema)
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.skills.deleteLocal(input);
      if (!result.ok) throw toTrpcError(result.error);
    }),
});
