import { Subject, type Observable } from "rxjs";
import { filter } from "rxjs/operators";
import type { ContentBlock } from "@agentclientprotocol/sdk/dist/schema/types.gen.js";

export type TurnOutcome = "success" | "failure";

export enum EventType {
  UserAuthenticated = "UserAuthenticated",
  AgentCreated = "AgentCreated",
  AgentUpdated = "AgentUpdated",
  AgentDeleted = "AgentDeleted",
  AgentRestarted = "AgentRestarted",
  AgentWoken = "AgentWoken",
  SlackConnected = "SlackConnected",
  SlackDisconnected = "SlackDisconnected",
  ChannelTurnRelayed = "ChannelTurnRelayed",
  ScheduleFired = "ScheduleFired",
  ConnectionCreated = "ConnectionCreated",
  ConnectionRemoved = "ConnectionRemoved",
  FilesImported = "FilesImported",
  ContributionApplyFailed = "ContributionApplyFailed",
  ContributionRecovered = "ContributionRecovered",
  ContributionApplyGaveUp = "ContributionApplyGaveUp",
}

export type UserAuthenticated = {
  type: EventType.UserAuthenticated;
  userSub: string;
  surface: string;
  isCore: boolean;
};

export type AgentCreated = {
  type: EventType.AgentCreated;
  agentId: string;
  ownerSub: string;
};

export type AgentUpdated = {
  type: EventType.AgentUpdated;
  agentId: string;
};

export type AgentDeleted = {
  type: EventType.AgentDeleted;
  agentId: string;
};

export type AgentRestarted = {
  type: EventType.AgentRestarted;
  agentId: string;
};

export type AgentWoken = {
  type: EventType.AgentWoken;
  agentId: string;
};

export type SlackConnected = {
  type: EventType.SlackConnected;
  agentId: string;
  slackChannelId: string;
};

export type SlackDisconnected = {
  type: EventType.SlackDisconnected;
  agentId: string;
  slackChannelId?: string;
};

export type ChannelTurnRelayed = {
  type: EventType.ChannelTurnRelayed;
  channel: "slack" | "telegram";
  agentId: string;
  actorSub: string | null;
  externalActorId?: string;
  outcome: TurnOutcome;
  reason?: string;
};

export type ScheduleFired = {
  type: EventType.ScheduleFired;
  scheduleId: string;
  agentId: string;
  ownerSub: string;
  mode: "fresh" | "continuous";
  sessionId: string | null;
  outcome: TurnOutcome;
};

export type ConnectionKind = "oauth_app" | "mcp";

export type ConnectionCreated = {
  type: EventType.ConnectionCreated;
  actorSub: string;
  connectionKey: string;
  kind: ConnectionKind;
};

export type ConnectionRemoved = {
  type: EventType.ConnectionRemoved;
  actorSub: string;
  connectionKey: string;
  kind: ConnectionKind;
};

export type FilesImported = {
  type: EventType.FilesImported;
  actorSub: string;
  agentId: string;
  outcome: TurnOutcome;
  bytes: number;
};

export type ContributionApplyFailed = {
  type: EventType.ContributionApplyFailed;
  agentId: string;
  kind: string;
  message: string;
};

export type ContributionRecovered = {
  type: EventType.ContributionRecovered;
  agentId: string;
  kind: string;
};

export type ContributionApplyGaveUp = {
  type: EventType.ContributionApplyGaveUp;
  agentId: string;
  kind: string;
  message: string;
};

export type DomainEvent =
  | UserAuthenticated
  | AgentCreated
  | AgentUpdated
  | AgentDeleted
  | AgentRestarted
  | AgentWoken
  | SlackConnected
  | SlackDisconnected
  | ChannelTurnRelayed
  | ScheduleFired
  | ConnectionCreated
  | ConnectionRemoved
  | FilesImported
  | ContributionApplyFailed
  | ContributionRecovered
  | ContributionApplyGaveUp;

const bus$ = new Subject<DomainEvent>();

export function emit(event: DomainEvent): void {
  bus$.next(event);
}

export function events$(): Observable<DomainEvent> {
  return bus$.asObservable();
}

export function ofType<T extends DomainEvent>(type: T["type"]) {
  return (source: Observable<DomainEvent>): Observable<T> =>
    source.pipe(filter((e): e is T => e.type === type));
}
