import { z } from "zod";
import { t } from "../../trpc.js";
import {
  checkAgentBinding,
  operateAgentsProcedure,
} from "../../auth-procedures.js";

const uploadInputSchema = z.object({
  agentId: z.string().min(1),
  path: z.string().min(1),
  contentBase64: z.string(),
  contentType: z.string().max(255).optional(),
  overwrite: z.boolean().optional(),
});

const uploadOutputSchema = z.object({
  mtimeMs: z.number(),
  absolutePath: z.string().optional(),
  contentType: z.string().optional(),
});

export type UploadFileInput = z.infer<typeof uploadInputSchema>;
export type UploadFileResult = z.infer<typeof uploadOutputSchema>;

export interface FilesService {
  upload(input: UploadFileInput): Promise<UploadFileResult>;
}

export const filesRouter = t.router({
  upload: operateAgentsProcedure
    .input(uploadInputSchema)
    .output(uploadOutputSchema)
    .mutation(({ ctx, input }) => {
      checkAgentBinding(ctx, input.agentId);
      return ctx.files.upload(input);
    }),
});
