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
  slackConnectWorkspaceInputSchema,
  slackConnectWorkspaceResultSchema,
  slackFireMentionInputSchema,
  slackImportHelmTokenInputSchema,
  slackSetChannelsInputSchema,
  slackRenewTokensInputSchema,
  slackTokenStateInputSchema,
  slackTokenStateResultSchema,
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

export type SlackConnectWorkspaceInput = z.infer<
  typeof slackConnectWorkspaceInputSchema
>;
export type SlackConnectWorkspaceResult = z.infer<
  typeof slackConnectWorkspaceResultSchema
>;
export type SlackFireMentionInput = z.infer<typeof slackFireMentionInputSchema>;
export type SlackFireMessageInput = SlackFireMentionInput;
export type SlackFireCommandInput = z.infer<typeof slackFireCommandInputSchema>;
export type SlackFireCommandResult = z.infer<
  typeof slackFireCommandResultSchema
>;
export type SlackOutboundRecord = z.infer<typeof slackOutboundRecordSchema>;
export type SlackReadOutboundResult = z.infer<
  typeof slackReadOutboundResultSchema
>;

export type SlackImportHelmTokenInput = z.infer<
  typeof slackImportHelmTokenInputSchema
>;
export type SlackSetChannelsInput = z.infer<typeof slackSetChannelsInputSchema>;
export type SlackRenewTokensInput = z.infer<typeof slackRenewTokensInputSchema>;
export type SlackTokenStateInput = z.infer<typeof slackTokenStateInputSchema>;
export type SlackTokenStateResult = z.infer<typeof slackTokenStateResultSchema>;

export interface E2eService {
  setScript(agentId: string, input: SetScriptInput): Promise<ResetResult>;
  getReceivedPrompts(agentId: string): Promise<GetReceivedPromptsResult>;
  reset(agentId: string): Promise<ResetResult>;
  getEnv(agentId: string, name: string): Promise<GetEnvResult>;
  performFetch(
    agentId: string,
    input: PerformFetchInput,
  ): Promise<PerformFetchResult>;
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
  slackConnectWorkspace(
    input: SlackConnectWorkspaceInput,
  ): Promise<SlackConnectWorkspaceResult>;
  slackSetChannels(input: SlackSetChannelsInput): Promise<ResetResult>;
  slackEnableTokenRotation(): Promise<ResetResult>;
  slackImportHelmToken(input: SlackImportHelmTokenInput): Promise<ResetResult>;
  slackRenewTokens(input: SlackRenewTokensInput): Promise<ResetResult>;
  slackTokenState(input: SlackTokenStateInput): Promise<SlackTokenStateResult>;
}
