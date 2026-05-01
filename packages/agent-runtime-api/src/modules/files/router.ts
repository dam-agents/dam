import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, t } from "../../trpc.js";
import type { FilesDomainError } from "./types.js";

const pathSchema = z.string().min(1);

function toTrpcError(error: FilesDomainError): TRPCError {
  switch (error.kind) {
    case "Forbidden":
      return new TRPCError({ code: "FORBIDDEN", message: error.reason });
    case "NotFound":
      return new TRPCError({ code: "NOT_FOUND" });
    case "Conflict":
      return new TRPCError({
        code: "CONFLICT",
        message: "file changed on disk",
        cause: { currentMtimeMs: error.currentMtimeMs },
      });
    case "AlreadyExists":
      return new TRPCError({ code: "CONFLICT", message: "path already exists" });
    case "PayloadTooLarge":
      return new TRPCError({ code: "PAYLOAD_TOO_LARGE", message: error.detail });
  }
}

export const filesRouter = t.router({
  tree: protectedProcedure.query(({ ctx }) => ({
    entries: ctx.files.buildTree(),
  })),

  read: protectedProcedure
    .input(z.object({ path: pathSchema }))
    .query(async ({ ctx, input }) => {
      const result = await ctx.files.readFileSafe(input.path);
      if (!result.ok) throw toTrpcError(result.error);
      return result.value;
    }),

  write: protectedProcedure
    .input(z.object({
      path: pathSchema,
      content: z.string(),
      expectedMtimeMs: z.number().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.files.writeFileSafe(
        input.path,
        input.content,
        input.expectedMtimeMs,
      );
      if (!result.ok) throw toTrpcError(result.error);
      return { mtimeMs: result.value.mtimeMs };
    }),

  create: protectedProcedure
    .input(z.object({ path: pathSchema, content: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.files.createFileSafe(input.path, input.content);
      if (!result.ok) throw toTrpcError(result.error);
      return { mtimeMs: result.value.mtimeMs };
    }),

  mkdir: protectedProcedure
    .input(z.object({ path: pathSchema }))
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.files.mkdirSafe(input.path);
      if (!result.ok) throw toTrpcError(result.error);
      return { ok: true as const };
    }),

  rename: protectedProcedure
    .input(z.object({
      from: pathSchema,
      to: pathSchema,
      overwrite: z.boolean().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.files.renameSafe(input.from, input.to, input.overwrite ?? false);
      if (!result.ok) throw toTrpcError(result.error);
      return { ok: true as const };
    }),

  remove: protectedProcedure
    .input(z.object({ path: pathSchema }))
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.files.deleteSafe(input.path);
      if (!result.ok) throw toTrpcError(result.error);
      return { ok: true as const };
    }),

  upload: protectedProcedure
    .input(z.object({
      path: pathSchema,
      contentBase64: z.string(),
      /** Browser-reported MIME (File.type). Carried in the API for observability
       *  and forward-compat; server-side reads still detect MIME from magic
       *  bytes so we don't need to persist this. */
      contentType: z.string().max(255).optional(),
      overwrite: z.boolean().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.files.uploadFileSafe(
        input.path,
        input.contentBase64,
        input.overwrite ?? false,
      );
      if (!result.ok) throw toTrpcError(result.error);
      return {
        mtimeMs: result.value.mtimeMs,
        absolutePath: result.value.absolutePath,
        contentType: input.contentType,
      };
    }),
});
