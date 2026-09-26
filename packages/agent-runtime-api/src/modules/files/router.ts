import { TRPCError } from "@trpc/server";
import { t } from "../../trpc.js";
import {
  fileCreateInputSchema,
  fileListDirsInputSchema,
  fileMkdirInputSchema,
  fileReadInputSchema,
  fileRemoveInputSchema,
  fileRenameInputSchema,
  fileUploadInputSchema,
  fileWriteInputSchema,
} from "./schemas.js";
import type { FilesDomainError } from "./types.js";

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
      return new TRPCError({
        code: "CONFLICT",
        message: "path already exists",
      });
    case "PayloadTooLarge":
      return new TRPCError({
        code: "PAYLOAD_TOO_LARGE",
        message: error.detail,
      });
  }
}

export const filesRouter = t.router({
  listDirs: t.procedure
    .input(fileListDirsInputSchema)
    .query(async ({ ctx, input }) => ({
      results: await ctx.files.listDirs(input.paths),
    })),

  watch: t.procedure
    .input(fileListDirsInputSchema)
    .subscription(async function* ({ ctx, input, signal }) {
      for await (const notice of ctx.files.watchDirs(input.paths, signal))
        yield notice;
    }),

  watchFile: t.procedure
    .input(fileReadInputSchema)
    .subscription(async function* ({ ctx, input, signal }) {
      for await (const notice of ctx.files.watchFile(input.path, signal))
        yield notice;
    }),

  read: t.procedure.input(fileReadInputSchema).query(async ({ ctx, input }) => {
    const result = await ctx.files.readFileSafe(input.path);
    if (!result.ok) throw toTrpcError(result.error);
    return result.value;
  }),

  write: t.procedure
    .input(fileWriteInputSchema)
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.files.writeFileSafe(
        input.path,
        input.content,
        input.expectedMtimeMs,
      );
      if (!result.ok) throw toTrpcError(result.error);
      return { mtimeMs: result.value.mtimeMs };
    }),

  create: t.procedure
    .input(fileCreateInputSchema)
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.files.createFileSafe(input.path, input.content);
      if (!result.ok) throw toTrpcError(result.error);
      return { mtimeMs: result.value.mtimeMs };
    }),

  mkdir: t.procedure
    .input(fileMkdirInputSchema)
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.files.mkdirSafe(input.path);
      if (!result.ok) throw toTrpcError(result.error);
      return { ok: true as const };
    }),

  rename: t.procedure
    .input(fileRenameInputSchema)
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.files.renameSafe(
        input.from,
        input.to,
        input.overwrite ?? false,
      );
      if (!result.ok) throw toTrpcError(result.error);
      return { ok: true as const };
    }),

  remove: t.procedure
    .input(fileRemoveInputSchema)
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.files.deleteSafe(input.path);
      if (!result.ok) throw toTrpcError(result.error);
      return { ok: true as const };
    }),

  upload: t.procedure
    .input(fileUploadInputSchema)
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
