import { z } from "zod";

export const FileFragmentSchema = z.record(z.string(), z.unknown());

export const MergeModeSchema = z.enum(["yaml-fill-if-missing"]);

export const FileSpecSchema = z.object({
  path: z.string(),
  mode: MergeModeSchema,
  fragments: z.array(FileFragmentSchema),
});

export const PodFilesEventSchema = z.object({
  files: z.array(FileSpecSchema),
});

export const EventKindSchema = z.enum(["snapshot", "upsert"]);

export type FileFragment = z.infer<typeof FileFragmentSchema>;
export type MergeMode = z.infer<typeof MergeModeSchema>;
export type FileSpec = z.infer<typeof FileSpecSchema>;
export type PodFilesEvent = z.infer<typeof PodFilesEventSchema>;
export type EventKind = z.infer<typeof EventKindSchema>;
