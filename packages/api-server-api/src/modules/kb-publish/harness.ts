import { z } from "zod";

export const contentHashSchema = z.string().regex(/^[0-9a-f]{64}$/);

export const kbPublishInventoryFileSchema = z.object({
  path: z.string().min(1),
  sizeBytes: z.number().int().nonnegative(),
  contentHash: contentHashSchema,
});

export const kbPublishRequestInputSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("plan"),
    files: z.array(kbPublishInventoryFileSchema).max(20_000),
  }),
  z.object({
    kind: z.literal("failure"),
    failure: z.object({
      code: z.string().min(1).max(64),
      root: z.string().max(512).optional(),
      detail: z.string().max(2_000).optional(),
    }),
  }),
]);

export const kbPublishCompleteInputSchema = z.object({
  ticket: z.string().min(1),
  report: z.object({
    uploadedBlobs: z
      .array(
        z.object({
          path: z.string().min(1),
          contentHash: contentHashSchema,
          sizeBytes: z.number().int().nonnegative(),
        }),
      )
      .max(20_000),
    segments: z
      .array(
        z.object({
          bucket: z.number().int().nonnegative(),
          docCount: z.number().int().nonnegative(),
          sizeBytes: z.number().int().nonnegative(),
          degraded: z.boolean(),
        }),
      )
      .max(512),
    drifted: z.array(z.string()).max(20_000),
  }),
});

export type KbPublishRequestInput = z.infer<typeof kbPublishRequestInputSchema>;
export type KbPublishInventoryFile = z.infer<
  typeof kbPublishInventoryFileSchema
>;
export type KbPublishCompleteReport = z.infer<
  typeof kbPublishCompleteInputSchema
>["report"];

export interface KbPublishWorkCaps {
  perFileMaxBytes: number;
  totalMaxBytes: number;
  maxFiles: number;
  maxWalkDepth: number;
}

export interface KbPublishWorkOrder {
  ticket: string;
  caps: KbPublishWorkCaps;
  bucketCount: number;
  blobs: { path: string; expectedHash: string; putUrl: string }[];
  segments: {
    bucket: number;
    members: { path: string; expectedHash: string }[];
    putUrl: string;
  }[];
}

export type KbPublishRequestResult =
  | { outcome: "not-shared" }
  | { outcome: "busy" }
  | { outcome: "rejected" }
  | { outcome: "up-to-date" }
  | { outcome: "work"; order: KbPublishWorkOrder };

export type KbPublishCompleteResult =
  | { outcome: "committed" }
  | { outcome: "retry" }
  | { outcome: "failed" };

export interface KbPublishGate {
  request(
    agentId: string,
    input: KbPublishRequestInput,
  ): Promise<KbPublishRequestResult>;
  complete(
    agentId: string,
    ticket: string,
    report: KbPublishCompleteReport,
  ): Promise<KbPublishCompleteResult>;
}
