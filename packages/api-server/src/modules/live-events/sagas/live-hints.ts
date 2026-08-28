import type { Subscription } from "rxjs";
import { events$, EventType, type DomainEvent } from "../../../events.js";
import { getLogger } from "../../../core/logger.js";
import { formatError } from "../../../core/format-error.js";
import type {
  LiveEventsBus,
  PublishableLiveEvent,
} from "../services/live-events-service.js";

export function hintFor(
  event: DomainEvent,
): { ownerSub: string; hint: PublishableLiveEvent } | null {
  switch (event.type) {
    case EventType.AgentCreated:
    case EventType.RuntimeHelloReceived:
      return {
        ownerSub: event.ownerSub,
        hint: { topic: "agents", agentId: event.agentId },
      };
    case EventType.ApprovalRequested:
    case EventType.ApprovalResolved:
      return {
        ownerSub: event.ownerSub,
        hint: { topic: "approvals", agentId: event.agentId },
      };
    case EventType.ScheduleFired:
    case EventType.ScheduleCreated:
    case EventType.ScheduleUpdated:
    case EventType.ScheduleDeleted:
      return {
        ownerSub: event.ownerSub,
        hint: { topic: "schedules", agentId: event.agentId },
      };
    case EventType.HarnessConfigChanged:
      return {
        ownerSub: event.ownerSub,
        hint: { topic: "harnessConfig", agentId: event.agentId },
      };
    case EventType.ArtifactCreated:
    case EventType.ArtifactUpdated:
    case EventType.ArtifactDeleted:
      return {
        ownerSub: event.ownerSub,
        hint: {
          topic: "artifacts",
          artifactId: event.artifactId,
          ...(event.agentId ? { agentId: event.agentId } : {}),
        },
      };
    case EventType.ArtifactFolderChanged:
      return { ownerSub: event.ownerSub, hint: { topic: "artifacts" } };
    case EventType.ExperimentChanged:
      return {
        ownerSub: event.ownerSub,
        hint: {
          topic: "experiments",
          experimentId: event.experimentId,
          agentId: event.agentId,
        },
      };
    case EventType.UserAuthenticated:
    case EventType.AgentUpdated:
    case EventType.AgentDeleted:
    case EventType.AgentRestarted:
    case EventType.AgentWoken:
    case EventType.SlackConnected:
    case EventType.SlackDisconnected:
    case EventType.ChannelTurnRelayed:
    case EventType.ConnectionCreated:
    case EventType.ConnectionRemoved:
    case EventType.FilesImported:
    case EventType.ContributionApplyFailed:
    case EventType.ContributionRecovered:
    case EventType.ContributionApplyGaveUp:
    case EventType.SessionTurnRelayed:
    case EventType.AgentRelayAttached:
    case EventType.ArtifactPublished:
    case EventType.ArtifactShared:
    case EventType.ArtifactViewed:
    case EventType.AgentSkillChanged:
    case EventType.SkillPublished:
    case EventType.SkillSetSaved:
    case EventType.SkillSetDeleted:
    case EventType.KindedAgentCreated:
    case EventType.InvocationSpawned:
    case EventType.FeatureFlagChanged:
    case EventType.ApiKeyChanged:
    case EventType.EntryPointChosen:
      return null;
    default: {
      const unhandled: never = event;
      return unhandled;
    }
  }
}

export function startLiveHintsSaga(bus: LiveEventsBus): Subscription {
  return events$().subscribe((event) => {
    try {
      const projected = hintFor(event);
      if (projected) bus.publish(projected.ownerSub, projected.hint);
    } catch (err) {
      getLogger().error(
        { sourceEvent: event.type, reason: formatError(err) },
        "live_hints.saga_error",
      );
    }
  });
}
