import type { EntryPointChoice } from "api-server-api";
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
  SessionTurnRelayed = "SessionTurnRelayed",
  AgentRelayAttached = "AgentRelayAttached",
  ScheduleFired = "ScheduleFired",
  ConnectionCreated = "ConnectionCreated",
  ConnectionRemoved = "ConnectionRemoved",
  FilesImported = "FilesImported",
  ContributionApplyFailed = "ContributionApplyFailed",
  ContributionRecovered = "ContributionRecovered",
  ContributionApplyGaveUp = "ContributionApplyGaveUp",
  RuntimeHelloReceived = "RuntimeHelloReceived",
  ApprovalRequested = "ApprovalRequested",
  ApprovalResolved = "ApprovalResolved",
  ScheduleCreated = "ScheduleCreated",
  ScheduleUpdated = "ScheduleUpdated",
  ScheduleDeleted = "ScheduleDeleted",
  HarnessConfigChanged = "HarnessConfigChanged",
  ArtifactCreated = "ArtifactCreated",
  ArtifactUpdated = "ArtifactUpdated",
  ArtifactDeleted = "ArtifactDeleted",
  ArtifactFolderChanged = "ArtifactFolderChanged",
  ExperimentChanged = "ExperimentChanged",
  ArtifactPublished = "ArtifactPublished",
  ArtifactShared = "ArtifactShared",
  ArtifactViewed = "ArtifactViewed",
  AgentSkillChanged = "AgentSkillChanged",
  SkillPublished = "SkillPublished",
  SkillSetSaved = "SkillSetSaved",
  SkillSetDeleted = "SkillSetDeleted",
  KindedAgentCreated = "KindedAgentCreated",
  InvocationSpawned = "InvocationSpawned",
  FeatureFlagChanged = "FeatureFlagChanged",
  ApiKeyChanged = "ApiKeyChanged",
  EntryPointChosen = "EntryPointChosen",
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
  outcome: TurnOutcome;
};

export type ConnectionKind = "oauth_app" | "mcp";

export type ConnectionCreated = {
  type: EventType.ConnectionCreated;
  actorSub: string;
  connectionKey: string;
  templateId: string;
  kind: ConnectionKind;
};

export type ConnectionRemoved = {
  type: EventType.ConnectionRemoved;
  actorSub: string;
  connectionKey: string;
  templateId: string;
  kind: ConnectionKind;
};

export type FilesImported = {
  type: EventType.FilesImported;
  actorSub: string;
  agentId: string;
  surface: string;
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

export type RuntimeHelloReceived = {
  type: EventType.RuntimeHelloReceived;
  agentId: string;
  ownerSub: string;
};

export type ApprovalRequested = {
  type: EventType.ApprovalRequested;
  approvalId: string;
  agentId: string;
  ownerSub: string;
};

export type ApprovalResolved = {
  type: EventType.ApprovalResolved;
  approvalId: string;
  agentId: string;
  ownerSub: string;
};

export type ScheduleCreated = {
  type: EventType.ScheduleCreated;
  scheduleId: string;
  agentId: string;
  ownerSub: string;
};

export type ScheduleUpdated = {
  type: EventType.ScheduleUpdated;
  scheduleId: string;
  agentId: string;
  ownerSub: string;
};

export type ScheduleDeleted = {
  type: EventType.ScheduleDeleted;
  scheduleId: string;
  agentId: string;
  ownerSub: string;
};

export type HarnessConfigChanged = {
  type: EventType.HarnessConfigChanged;
  agentId: string;
  ownerSub: string;
  actorSub?: string;
  surface?: string;
};

export type ArtifactCreated = {
  type: EventType.ArtifactCreated;
  artifactId: string;
  ownerSub: string;
  agentId?: string;
};

export type ArtifactUpdated = {
  type: EventType.ArtifactUpdated;
  artifactId: string;
  ownerSub: string;
  agentId?: string;
};

export type ArtifactDeleted = {
  type: EventType.ArtifactDeleted;
  artifactId: string;
  ownerSub: string;
  agentId?: string;
  actorSub?: string;
  surface?: string;
};

export type ArtifactFolderChanged = {
  type: EventType.ArtifactFolderChanged;
  folderId: string;
  ownerSub: string;
};

export type ExperimentChanged = {
  type: EventType.ExperimentChanged;
  experimentId: string;
  agentId: string;
  ownerSub: string;
  action?: "started" | "stopped" | "deleted";
  actorSub?: string;
  surface?: string;
};

export type SessionTurnRelayed = {
  type: EventType.SessionTurnRelayed;
  agentId: string;
  actorSub: string;
  surface: string;
};

export type AgentRelayAttached = {
  type: EventType.AgentRelayAttached;
  agentId: string;
  actorSub: string;
  surface: string;
  relay: string;
};

export type ArtifactPublished = {
  type: EventType.ArtifactPublished;
  actorSub: string;
  artifactId: string;
  agentId: string | null;
  kind: string;
  visibility: string;
  surface: string;
};

export type ArtifactShared = {
  type: EventType.ArtifactShared;
  actorSub: string;
  artifactId: string;
  visibility: string;
  surface: string;
};

export type ArtifactViewed = {
  type: EventType.ArtifactViewed;
  artifactId: string;
  ownerSub: string;
};

export type SkillOrigin = "source" | "local";

export type SkillChangeAction = "installed" | "uninstalled";

export type AgentSkillChanged = {
  type: EventType.AgentSkillChanged;
  action: SkillChangeAction;
  agentId: string;
  actorSub: string;
  surface: string;
  origin: SkillOrigin;
  name: string;
  source?: string;
};

export type SkillPublished = {
  type: EventType.SkillPublished;
  agentId: string;
  actorSub: string;
  surface: string;
  name: string;
};

export type SkillSetSaved = {
  type: EventType.SkillSetSaved;
  actorSub: string;
  surface: string;
  skillCount: number;
};

export type SkillSetDeleted = {
  type: EventType.SkillSetDeleted;
  actorSub: string;
  surface: string;
};

export type KindedAgentCreated = {
  type: EventType.KindedAgentCreated;
  agentId: string;
  actorSub: string;
  surface: string;
  kind: string;
};

export type InvocationSpawned = {
  type: EventType.InvocationSpawned;
  targetAgentId: string;
  driverAgentId: string;
  ownerSub: string;
};

export type FeatureFlagChanged = {
  type: EventType.FeatureFlagChanged;
  actorSub: string;
  surface: string;
  feature: string;
  enabled: boolean;
};

export type ApiKeyChanged = {
  type: EventType.ApiKeyChanged;
  action: "created" | "revoked";
  actorSub: string;
  surface: string;
};

export type EntryPointChosen = {
  type: EventType.EntryPointChosen;
  actorSub: string;
  choice: EntryPointChoice;
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
  | ContributionApplyGaveUp
  | RuntimeHelloReceived
  | ApprovalRequested
  | ApprovalResolved
  | ScheduleCreated
  | ScheduleUpdated
  | ScheduleDeleted
  | HarnessConfigChanged
  | ArtifactCreated
  | ArtifactUpdated
  | ArtifactDeleted
  | ArtifactFolderChanged
  | ExperimentChanged
  | SessionTurnRelayed
  | AgentRelayAttached
  | ArtifactPublished
  | ArtifactShared
  | ArtifactViewed
  | AgentSkillChanged
  | SkillPublished
  | SkillSetSaved
  | SkillSetDeleted
  | KindedAgentCreated
  | InvocationSpawned
  | FeatureFlagChanged
  | ApiKeyChanged
  | EntryPointChosen;

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
