import { z } from "zod";

import { RPC_ID_MAX } from "./format.js";

const rpcIdSchema = z.union([
  z.string().min(1).max(RPC_ID_MAX),
  z.number().int(),
]);

const reportedSessionIdSchema = z.string().min(1).max(200);

export const toolApprovalWaitingInputSchema = z.object({
  sessionId: reportedSessionIdSchema,
  rpcId: rpcIdSchema,
  toolName: z.string().min(1).max(4096),
  toolCallId: z.string().min(1).max(512).optional(),
  args: z.unknown().optional(),
  options: z
    .array(
      z.object({
        optionId: z.string().min(1).max(512),
        kind: z
          .enum(["allow_once", "allow_always", "reject_once", "reject_always"])
          .optional()
          .catch(undefined),
      }),
    )
    .max(16),
});

export const toolApprovalEndedInputSchema = z.object({
  sessionId: reportedSessionIdSchema,
  rpcId: rpcIdSchema,
  outcome: z
    .object({
      outcome: z.string().min(1).max(64),
      optionId: z.string().min(1).max(512).optional(),
      kind: z
        .enum(["allow_once", "allow_always", "reject_once", "reject_always"])
        .optional()
        .catch(undefined),
    })
    .optional(),
});

export type ToolApprovalWaitingInput = z.infer<
  typeof toolApprovalWaitingInputSchema
>;
export type ToolApprovalEndedInput = z.infer<
  typeof toolApprovalEndedInputSchema
>;

export interface ToolApprovalReports {
  waiting(agentId: string, input: ToolApprovalWaitingInput): Promise<void>;
  ended(agentId: string, input: ToolApprovalEndedInput): Promise<void>;
}
