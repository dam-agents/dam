import type { z } from "zod";
import type {
  e2ePerformFetchInputSchema,
  e2eSpawnInvocationInputSchema,
  getEnvResultSchema,
  getReceivedPromptsResultSchema,
  performFetchResultSchema,
  resetResultSchema,
  setScriptInputSchema,
  slackFireCommandInputSchema,
  slackFireCommandResultSchema,
  slackFireMentionInputSchema,
  slackOutboundRecordSchema,
  slackReadOutboundResultSchema,
  spawnInvocationResultSchema,
} from "./schemas.js";

export type SetScriptInput = z.infer<typeof setScriptInputSchema>;
export type GetReceivedPromptsResult = z.infer<
  typeof getReceivedPromptsResultSchema
>;
export type ResetResult = z.infer<typeof resetResultSchema>;
export type GetEnvResult = z.infer<typeof getEnvResultSchema>;
export type PerformFetchResult = z.infer<typeof performFetchResultSchema>;
export type PerformFetchInput = Omit<
  z.infer<typeof e2ePerformFetchInputSchema>,
  "agentId"
>;
export type SpawnInvocationInput = Omit<
  z.infer<typeof e2eSpawnInvocationInputSchema>,
  "agentId"
>;
export type SpawnInvocationResult = z.infer<typeof spawnInvocationResultSchema>;

export type SlackFireMentionInput = z.infer<typeof slackFireMentionInputSchema>;
/** Same wire shape as a mention — only the trigger differs (ambient mode). */
export type SlackFireMessageInput = SlackFireMentionInput;
export type SlackFireCommandInput = z.infer<typeof slackFireCommandInputSchema>;
export type SlackFireCommandResult = z.infer<
  typeof slackFireCommandResultSchema
>;
export type SlackOutboundRecord = z.infer<typeof slackOutboundRecordSchema>;
export type SlackReadOutboundResult = z.infer<
  typeof slackReadOutboundResultSchema
>;

export interface E2eService {
  setScript(agentId: string, input: SetScriptInput): Promise<ResetResult>;
  getReceivedPrompts(agentId: string): Promise<GetReceivedPromptsResult>;
  reset(agentId: string): Promise<ResetResult>;
  getEnv(agentId: string, name: string): Promise<GetEnvResult>;
  performFetch(
    agentId: string,
    input: PerformFetchInput,
  ): Promise<PerformFetchResult>;
  /** Make the mock agent spawn an Invocation as the driver, through the same
   *  harness POST the driver SDK uses. Returns the target agent id. */
  spawnInvocation(
    agentId: string,
    input: SpawnInvocationInput,
  ): Promise<SpawnInvocationResult>;
  slackFireMention(input: SlackFireMentionInput): Promise<ResetResult>;
  slackFireMessage(input: SlackFireMessageInput): Promise<ResetResult>;
  slackFireCommand(
    input: SlackFireCommandInput,
  ): Promise<SlackFireCommandResult>;
  slackReadOutbound(): Promise<SlackReadOutboundResult>;
  slackResetOutbound(): Promise<ResetResult>;
}
