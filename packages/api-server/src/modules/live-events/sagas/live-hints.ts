import type { Subscription } from "rxjs";
import { events$, EventType, type DomainEvent } from "../../../events.js";
import { getLogger } from "../../../core/logger.js";
import { formatError } from "../../../core/format-error.js";
import {
  editorAudience,
  type PublishableLiveEvent,
} from "../services/live-events-service.js";
import type { EditorFanoutBus } from "../infrastructure/editor-fanout-bus.js";

export function hintFor(event: DomainEvent): {
  ownerSub: string | null;
  hint: PublishableLiveEvent;
  editorEmails?: readonly string[];
} | null {
  switch (event.type) {
    case EventType.AgentCreated:
    case EventType.RuntimeHelloReceived:
    case EventType.WorkspaceMutationSettled:
    case EventType.ContributionGapChanged:
      return {
        ownerSub: event.ownerSub,
        hint: { topic: "agents", agentId: event.agentId },
      };
    case EventType.AgentUpdated:
    case EventType.AgentDeleted:
      return event.ownerSub
        ? {
            ownerSub: event.ownerSub,
            hint: { topic: "agents", agentId: event.agentId },
          }
        : null;
    case EventType.AgentEditorsChanged:
      return {
        ownerSub: event.ownerSub ?? null,
        hint: { topic: "agents", agentId: event.agentId },
        editorEmails: event.emails,
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
    case EventType.SchedulePrecheckReported:
      return {
        ownerSub: event.ownerSub,
        hint: { topic: "schedules", agentId: event.agentId },
      };
    case EventType.HarnessConfigChanged:
      return {
        ownerSub: event.ownerSub,
        hint: { topic: "harnessConfig", agentId: event.agentId },
      };
    case EventType.AttentionChanged:
      return {
        ownerSub: event.ownerSub,
        hint: { topic: "attention", agentId: event.agentId },
      };
    case EventType.SlackConnected:
    case EventType.SlackDisconnected:
      return event.ownerSub
        ? {
            ownerSub: event.ownerSub,
            hint: { topic: "attention", agentId: event.agentId },
          }
        : null;
    case EventType.TelegramChatBound:
    case EventType.TelegramChatUnbound:
      return {
        ownerSub: event.ownerSub,
        hint: { topic: "attention", agentId: event.agentId },
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
    case EventType.KbSharePublished:
    case EventType.KbSharePublishFailed:
      return {
        ownerSub: event.ownerSub,
        hint: { topic: "kbShares", agentId: event.agentId },
      };
    case EventType.AvatarUnlocked:
    case EventType.GettingStartedReset:
      return { ownerSub: event.ownerSub, hint: { topic: "gettingStarted" } };
    case EventType.UserAuthenticated:
    case EventType.AgentRestarted:
    case EventType.AgentWoken:
    case EventType.ChannelTurnRelayed:
    case EventType.ChannelMessageSent:
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
    case EventType.SkillSourceChanged:
    case EventType.StarterKitApplied:
    case EventType.InvocationSpawned:
    case EventType.FeatureFlagChanged:
    case EventType.ApiKeyChanged:
    case EventType.EntryPointChosen:
    case EventType.StarterKitOnboarded:
    case EventType.IdentityLinked:
    case EventType.AgentOutOfMemory:
    case EventType.AgentResourceRemoved:
    case EventType.SpendLimitsChanged:
    case EventType.GatewayCallEnded:
    case EventType.ProviderStatusEvaluated:
      return null;
    default: {
      const unhandled: never = event;
      return unhandled;
    }
  }
}

export function startLiveHintsSaga(bus: EditorFanoutBus): Subscription {
  return events$().subscribe((event) => {
    try {
      if (event.type === EventType.AgentEditorsChanged)
        bus.forgetEditors(event.agentId);
      const projected = hintFor(event);
      if (!projected) return;
      if (projected.ownerSub) bus.publish(projected.ownerSub, projected.hint);
      for (const email of projected.editorEmails ?? [])
        bus.publish(editorAudience(email), projected.hint);
    } catch (err) {
      getLogger().error(
        { sourceEvent: event.type, reason: formatError(err) },
        "live_hints.saga_error",
      );
    }
  });
}
