/**
 * Wire contract for the pod-files SSE channel.
 *
 * Single source of truth for both ends:
 *   - api-server emits these events on `/api/instances/:id/pod-files/events`
 *   - agent-runtime subscribes and materializes the files inside the agent pod
 *
 * Schemas double as runtime validators — agent-runtime parses each incoming
 * row through `FileSpecSchema` so a malformed entry can be dropped without
 * killing the whole payload.
 */
import { z } from "zod";

/** A producer's contribution to a file. Shape depends on `mode`. */
export const FileFragmentSchema = z.record(z.string(), z.unknown());

export const MergeModeSchema = z.enum(["yaml-fill-if-missing"]);

export const FileSpecSchema = z.object({
  path: z.string(),
  mode: MergeModeSchema,
  fragments: z.array(FileFragmentSchema),
});

/** Payload for both `snapshot` and `upsert` SSE events. */
export const PodFilesEventSchema = z.object({
  files: z.array(FileSpecSchema),
});

export const EventKindSchema = z.enum(["snapshot", "upsert"]);

export type FileFragment = z.infer<typeof FileFragmentSchema>;
export type MergeMode = z.infer<typeof MergeModeSchema>;
export type FileSpec = z.infer<typeof FileSpecSchema>;
export type PodFilesEvent = z.infer<typeof PodFilesEventSchema>;
export type EventKind = z.infer<typeof EventKindSchema>;
