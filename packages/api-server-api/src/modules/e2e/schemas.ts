import { z } from "zod";

export const scriptEntrySchema = z
  .object({
    delayMs: z.number().int().nonnegative().optional(),
    sessionUpdate: z.record(z.string(), z.unknown()),
  })
  .strict();

export const scriptFileSchema = z
  .object({
    path: z.string().min(1),
    content: z.string(),
  })
  .strict();

export const setScriptInputSchema = z
  .object({
    entries: z.array(scriptEntrySchema),
    files: z.array(scriptFileSchema).optional(),
    stopReason: z.string().default("end_turn"),
  })
  .strict();

export const receivedPromptSchema = z
  .object({
    sessionId: z.string(),
    receivedAt: z.string(),
    prompt: z.unknown().optional(),
  })
  .strict();

export const getReceivedPromptsResultSchema = z
  .object({
    prompts: z.array(receivedPromptSchema),
  })
  .strict();

export const resetResultSchema = z.object({ ok: z.literal(true) }).strict();

export const e2eAgentIdInputSchema = z
  .object({ agentId: z.string().min(1) })
  .strict();

export const e2eSetScriptInputSchema = z
  .object({
    agentId: z.string().min(1),
    script: setScriptInputSchema,
  })
  .strict();

export const getEnvResultSchema = z
  .object({ value: z.string().optional() })
  .strict();

export const performFetchResultSchema = z
  .object({
    status: z.number().int(),
    body: z.string(),
  })
  .strict();

export const e2eGetEnvInputSchema = z
  .object({
    agentId: z.string().min(1),
    name: z.string().min(1),
  })
  .strict();

export const e2ePerformFetchInputSchema = z
  .object({
    agentId: z.string().min(1),
    url: z.string().url(),
    headers: z.record(z.string(), z.string()).optional(),
  })
  .strict();

export const e2eSpawnInvocationInputSchema = z
  .object({
    agentId: z.string().min(1),
    prompt: z.string().min(1),
    schema: z.record(z.string(), z.unknown()),
    templateId: z.string().min(1).optional(),
    image: z.string().min(1).optional(),
    connections: z.array(z.string()).optional(),
    ttlMs: z.number().int().positive().optional(),
  })
  .strict();

export const spawnInvocationResultSchema = z
  .object({ id: z.string().min(1) })
  .strict();

export const slackFireMentionInputSchema = z
  .object({
    user: z.string().min(1),
    channel: z.string().min(1),
    ts: z.string().min(1),
    threadTs: z.string().optional(),
    text: z.string(),
    teamId: z.string().optional(),
  })
  .strict();

export const slackFireMessageInputSchema = slackFireMentionInputSchema;

export const slackFireCommandInputSchema = z
  .object({
    text: z.string(),
    userId: z.string().min(1),
    channelId: z.string().min(1),
  })
  .strict();

export const slackFireCommandResultSchema = z
  .object({ ack: z.string() })
  .strict();

export const slackOutboundRecordSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("message"),
      channel: z.string(),
      text: z.string(),
      threadTs: z.string().optional(),
      replyBroadcast: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("ephemeral"),
      channel: z.string(),
      user: z.string(),
      text: z.string(),
      threadTs: z.string().optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("reaction"),
      channel: z.string(),
      ts: z.string(),
      name: z.string(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("upload"),
      channelId: z.string(),
      filename: z.string(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("stream_start"),
      channel: z.string(),
      threadTs: z.string(),
      ts: z.string(),
      text: z.string(),
      recipientTeamId: z.string().optional(),
      recipientUserId: z.string().optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("stream_append"),
      channel: z.string(),
      ts: z.string(),
      text: z.string(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("stream_stop"),
      channel: z.string(),
      ts: z.string(),
      text: z.string().optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("status"),
      channel: z.string(),
      threadTs: z.string(),
      status: z.string(),
    })
    .strict(),
]);

export const slackReadOutboundResultSchema = z
  .object({ records: z.array(slackOutboundRecordSchema) })
  .strict();
