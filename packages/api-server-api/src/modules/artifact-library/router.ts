import { TRPCError } from "@trpc/server";
import { t } from "../../trpc.js";
import {
  manageAgentsProcedure,
  readAgentProcedure,
} from "../../auth-procedures.js";
import {
  artifactContentInputSchema,
  artifactCreateInputSchema,
  artifactIdInputSchema,
  artifactListInputSchema,
  artifactSharingInputSchema,
  artifactUpdateInputSchema,
  artifactUploadUrlInputSchema,
  folderCreateInputSchema,
  folderIdInputSchema,
  folderUpdateInputSchema,
} from "./schemas.js";

export const artifactLibraryRouter = t.router({
  list: readAgentProcedure
    .input(artifactListInputSchema.optional())
    .query(({ ctx, input }) => ctx.artifactLibrary.list(input)),

  get: readAgentProcedure
    .input(artifactIdInputSchema)
    .query(async ({ ctx, input }) => {
      const artifact = await ctx.artifactLibrary.get(input.id);
      if (!artifact) throw new TRPCError({ code: "NOT_FOUND" });
      return artifact;
    }),

  getContent: readAgentProcedure
    .input(artifactContentInputSchema)
    .query(async ({ ctx, input }) => {
      const content = await ctx.artifactLibrary.getContent(
        input.id,
        input.version,
      );
      if (!content) throw new TRPCError({ code: "NOT_FOUND" });
      return content;
    }),

  preview: readAgentProcedure
    .input(artifactContentInputSchema)
    .query(({ ctx, input }) =>
      ctx.artifactLibrary.getPreviewHtml(input.id, input.version),
    ),

  listVersions: readAgentProcedure
    .input(artifactIdInputSchema)
    .query(({ ctx, input }) => ctx.artifactLibrary.listVersions(input.id)),

  create: manageAgentsProcedure
    .input(artifactCreateInputSchema)
    .mutation(({ ctx, input }) => ctx.artifactLibrary.create(input)),

  update: manageAgentsProcedure
    .input(artifactUpdateInputSchema)
    .mutation(({ ctx, input: { id, ...rest } }) =>
      ctx.artifactLibrary.update(id, rest),
    ),

  setSharing: manageAgentsProcedure
    .input(artifactSharingInputSchema)
    .mutation(({ ctx, input: { id, ...rest } }) =>
      ctx.artifactLibrary.setSharing(id, rest),
    ),

  delete: manageAgentsProcedure
    .input(artifactIdInputSchema)
    .mutation(({ ctx, input }) => ctx.artifactLibrary.delete(input.id)),

  createUploadUrl: manageAgentsProcedure
    .input(artifactUploadUrlInputSchema)
    .mutation(({ ctx, input }) =>
      ctx.artifactLibrary.createUploadUrl(input.fileName),
    ),

  listFolders: readAgentProcedure.query(({ ctx }) =>
    ctx.artifactLibrary.listFolders(),
  ),

  createFolder: manageAgentsProcedure
    .input(folderCreateInputSchema)
    .mutation(({ ctx, input }) => ctx.artifactLibrary.createFolder(input.name)),

  updateFolder: manageAgentsProcedure
    .input(folderUpdateInputSchema)
    .mutation(({ ctx, input: { id, ...rest } }) =>
      ctx.artifactLibrary.updateFolder(id, rest),
    ),

  deleteFolder: manageAgentsProcedure
    .input(folderIdInputSchema)
    .mutation(({ ctx, input }) => ctx.artifactLibrary.deleteFolder(input.id)),

  folderShareUrl: readAgentProcedure
    .input(folderIdInputSchema)
    .query(({ ctx, input }) => ctx.artifactLibrary.folderShareUrl(input.id)),
});
