import { type EnvVar, ChannelType } from "../shared.js";

export { ChannelType };

export interface Channel {
  type: ChannelType;
}

export interface SlackChannel extends Channel {
  type: ChannelType.Slack;
  slackChannelId: string;
}

export interface TelegramChannel extends Channel {
  type: ChannelType.Telegram;
}

export type ChannelConfig = SlackChannel | TelegramChannel;

export type InstanceState = "starting" | "running" | "hibernating" | "hibernated" | "error";

export interface Instance {
  id: string;
  name: string;
  agentId: string;
  description?: string;
  state: InstanceState;
  error?: string;
  channels: ChannelConfig[];
  allowedUserEmails: string[];
}

export interface CreateInstanceInput {
  name: string;
  agentId: string;
  env?: EnvVar[];
  secretRef?: string;
  description?: string;
  allowedUserEmails?: string[];
}

export interface UpdateInstanceInput {
  id: string;
  env?: EnvVar[];
  secretRef?: string;
  allowedUserEmails?: string[];
}

export type ConnectSlackError =
  | { type: "InstanceNotFound" }
  | { type: "ChannelAlreadyBound" };

export type ConnectSlackResult =
  | { ok: true; value: Instance }
  | { ok: false; error: ConnectSlackError };

export interface InstancesService {
  list: () => Promise<Instance[]>;
  get: (id: string) => Promise<Instance | null>;
  create: (input: CreateInstanceInput) => Promise<Instance>;
  update: (input: UpdateInstanceInput) => Promise<Instance | null>;
  delete: (id: string) => Promise<void>;
  restart: (id: string) => Promise<boolean>;
  wake: (id: string) => Promise<Instance | null>;
  /**
   * Ensure the instance's pod is reachable. Waits for pod Ready, waking
   * from hibernation if needed. Idempotent; single-flight per id; bumps
   * `humr.ai/last-activity` on every success. Channel adapters and any
   * server-side caller that needs to talk to the agent must await this
   * before connecting. See ADR-032.
   */
  ensureReady: (id: string) => Promise<void>;
  connectSlack: (id: string, slackChannelId: string) => Promise<ConnectSlackResult>;
  disconnectSlack: (id: string) => Promise<Instance | null>;
  connectTelegram: (id: string, botToken: string) => Promise<Instance | null>;
  disconnectTelegram: (id: string) => Promise<Instance | null>;
  isAllowedUser: (instanceId: string, keycloakSub: string) => Promise<boolean>;
}
