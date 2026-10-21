import type { ArtifactApiRequestInput } from "agent-runtime-api";
import type { ArtifactCallAgentApiResult } from "api-server-api";

import { securityLog } from "../../../core/security-log.js";
import type { ShareSession } from "../domain/share-session.js";
import {
  viewerBridgeAccess,
  viewerPromptText,
  viewerSessionKey,
  viewerSessionTitle,
  type ViewerBridgeDenial,
  type ViewerPromptResult,
} from "../domain/viewer-bridge.js";
import type { AgentApiPodClient } from "../infrastructure/agent-api-pod-client.js";
import type { ArtifactRow } from "../infrastructure/artifact-library-repository.js";

export type ViewerPromptOutcome =
  "accepted" | "spend-limit" | "agent-unreachable";

export interface ViewerPromptDelivery {
  deliver(input: {
    agentId: string;
    sessionKey: string;
    sessionTitle: string;
    prompt: string;
  }): Promise<ViewerPromptOutcome>;
}

export type ViewerCallKind = "request" | "prompt";

export interface ShareBridgeService {
  request(
    artifact: ArtifactRow,
    viewer: ShareSession,
    input: ArtifactApiRequestInput,
  ): Promise<ArtifactCallAgentApiResult>;
  prompt(
    artifact: ArtifactRow,
    viewer: ShareSession,
    prompt: string,
  ): Promise<ViewerPromptResult>;
  refuse(
    artifact: ArtifactRow,
    viewer: ShareSession,
    kind: ViewerCallKind,
    denial: ViewerBridgeDenial,
  ): void;
}

function viewerName(viewer: ShareSession): string {
  return viewer.email ?? viewer.sub;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: a viewer of a shared interactive page acts on
 * the owner's Agent under the owner's grant, as a person in a shared Slack
 * channel does. The share host checks the viewer against the viewer list on
 * every call; this service then checks the artifact itself, and relays a
 * request to the Agent's Artifact API server or hands a prompt to the
 * viewer's own Session on the Agent. Every call, allowed or refused, goes to
 * the security log with the viewer, the artifact and the owner, and never
 * with the prompt text or the request path.
 */
export function createShareBridgeService(deps: {
  featureOn: (owner: string) => Promise<boolean>;
  ensureReady: (agentId: string) => Promise<void>;
  agentApi: AgentApiPodClient;
  prompts: ViewerPromptDelivery;
}): ShareBridgeService {
  function log(
    artifact: ArtifactRow,
    viewer: ShareSession,
    kind: ViewerCallKind,
    denial: ViewerBridgeDenial | null,
  ): void {
    securityLog(denial === null ? "info" : "warn", `artifact.viewer_${kind}`, {
      category: "authz",
      actor: viewer.sub,
      actorKind: "external",
      surface: "share",
      decision: denial === null ? "allow" : "deny",
      target: artifact.id,
      ...(artifact.agentId ? { agentId: artifact.agentId } : {}),
      ...(denial === null ? {} : { reason: denial }),
      detail: { viewerEmail: viewer.email, owner: artifact.owner },
    });
  }

  async function agentFor(
    artifact: ArtifactRow,
    viewer: ShareSession,
    kind: ViewerCallKind,
  ): Promise<string | null> {
    const decided = viewerBridgeAccess(
      artifact,
      await deps.featureOn(artifact.owner),
    );
    log(artifact, viewer, kind, decided.allowed ? null : decided.denial);
    return decided.allowed ? decided.agentId : null;
  }

  return {
    async request(artifact, viewer, input) {
      const agentId = await agentFor(artifact, viewer, "request");
      if (agentId === null) return { ok: false, reason: "not-allowed" };
      try {
        await deps.ensureReady(agentId);
      } catch {
        return { ok: false, reason: "agent-unreachable" };
      }
      return deps.agentApi.request(agentId, input);
    },

    async prompt(artifact, viewer, prompt) {
      const agentId = await agentFor(artifact, viewer, "prompt");
      if (agentId === null) return { ok: false, reason: "not-allowed" };
      const name = viewerName(viewer);
      const outcome = await deps.prompts.deliver({
        agentId,
        sessionKey: viewerSessionKey(artifact.id, viewer.sub),
        sessionTitle: viewerSessionTitle(name, artifact.title),
        prompt: viewerPromptText({
          viewer: name,
          artifactId: artifact.id,
          artifactTitle: artifact.title,
          prompt,
        }),
      });
      return outcome === "accepted"
        ? { ok: true }
        : { ok: false, reason: outcome };
    },

    refuse(artifact, viewer, kind, denial) {
      log(artifact, viewer, kind, denial);
    },
  };
}
