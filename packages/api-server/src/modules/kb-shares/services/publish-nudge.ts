import { emit, EventType } from "../../../events.js";
import { securityLog } from "../../../core/security-log.js";
import type { KbPublishSyncInput } from "agent-runtime-api";
import { MAX_WALK_DEPTH } from "agent-runtime-api/kb-snapshot";

import type { KbPublishPodClient } from "../infrastructure/kb-publish-client.js";
import type { KbShareRow } from "../domain/types.js";
import {
  RUNTIME_UNSUPPORTED_MESSAGE,
  STALE_CLAIM_MS,
  type KbSharePublishLimits,
} from "./publish-service.js";

const SELF_PUBLISH_CAPABILITY = 2;
const CAPABILITY_WAIT_ATTEMPTS = 3;
const CAPABILITY_WAIT_MS = 2_000;

export interface KbShareFlushNudge {
  requestFlush(agentId: string): Promise<void>;
  attemptSync(agentId: string): Promise<void>;
  unconfigure(agentId: string): Promise<void>;
}

export interface KbShareFlushNudgeDeps {
  findActiveByAgent(agentId: string): Promise<KbShareRow | null>;
  ensureReady(agentId: string): Promise<void>;
  getRuntimeCapabilities(agentId: string): Promise<unknown | null>;
  pod: KbPublishPodClient;
  repo: {
    claimPublish(
      agentId: string,
      opts: { staleClaimMs: number },
    ): Promise<KbShareRow | null>;
    finishPublishFailure(
      agentId: string,
      error: string,
      expectedToken: string,
    ): Promise<boolean>;
  };
  limits: KbSharePublishLimits;
  log: (message: string) => void;
}

function extractKbPublishCapability(raw: unknown): number | null {
  if (!raw || typeof raw !== "object") return null;
  const value = (raw as { kbPublish?: unknown }).kbPublish;
  return typeof value === "number" ? value : 0;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: the server's only remaining initiative in the
 * publish flow — delivering share config (roots + caps) to the pod's flusher
 * and asking it to flush now. requestFlush is the strong form (create,
 * refresh, Refresh now): it wakes the pod and surfaces a publishError when
 * the runtime cannot self-publish. attemptSync is the quiet form (wake
 * catch-up, startup sweep): it never wakes a pod and swallows unsupported or
 * unreachable runtimes, because its callers are opportunistic.
 */
export function createKbShareFlushNudge(
  deps: KbShareFlushNudgeDeps,
): KbShareFlushNudge {
  function capsFor(): KbPublishSyncInput["caps"] {
    return {
      perFileMaxBytes: deps.limits.perFileMaxBytes,
      totalMaxBytes: deps.limits.totalMaxBytes,
      maxFiles: deps.limits.maxFiles,
      maxWalkDepth: MAX_WALK_DEPTH,
    };
  }

  async function capabilityFor(
    agentId: string,
    waitForHello: boolean,
  ): Promise<number | null> {
    for (let attempt = 0; ; attempt += 1) {
      const capability = extractKbPublishCapability(
        await deps.getRuntimeCapabilities(agentId),
      );
      if (capability !== null) return capability;
      if (!waitForHello || attempt >= CAPABILITY_WAIT_ATTEMPTS - 1) return null;
      await new Promise((resolve) => setTimeout(resolve, CAPABILITY_WAIT_MS));
    }
  }

  async function reportUnsupported(row: KbShareRow): Promise<void> {
    const claimed = await deps.repo.claimPublish(row.agentId, {
      staleClaimMs: STALE_CLAIM_MS,
    });
    if (!claimed || !claimed.publishToken) return;
    await deps.repo
      .finishPublishFailure(
        row.agentId,
        RUNTIME_UNSUPPORTED_MESSAGE,
        claimed.publishToken,
      )
      .catch(() => {});
    securityLog("warn", "kb_share.publish_failed", {
      category: "resource",
      actor: row.owner,
      actorKind: "user",
      agentId: row.agentId,
      result: "failure",
      reason: RUNTIME_UNSUPPORTED_MESSAGE,
    });
    emit({
      type: EventType.KbSharePublishFailed,
      agentId: row.agentId,
      ownerSub: row.owner,
      reason: RUNTIME_UNSUPPORTED_MESSAGE,
    });
  }

  return {
    async requestFlush(agentId) {
      const row = await deps.findActiveByAgent(agentId);
      if (!row) return;
      await deps.ensureReady(agentId);
      const capability = await capabilityFor(agentId, true);
      if (capability === null || capability < SELF_PUBLISH_CAPABILITY) {
        await reportUnsupported(row);
        return;
      }
      await deps.pod.sync(agentId, {
        roots: [...row.roots],
        caps: capsFor(),
        flush: true,
      });
    },

    async attemptSync(agentId) {
      try {
        const row = await deps.findActiveByAgent(agentId);
        if (!row) return;
        const capability = await capabilityFor(agentId, false);
        if (capability === null || capability < SELF_PUBLISH_CAPABILITY) {
          return;
        }
        await deps.pod.sync(agentId, {
          roots: [...row.roots],
          caps: capsFor(),
          flush: row.dirtyAt !== null,
        });
      } catch (err) {
        deps.log(`sync attempt failed for ${agentId}: ${err}`);
      }
    },

    async unconfigure(agentId) {
      try {
        await deps.pod.sync(agentId, {
          roots: null,
          caps: capsFor(),
          flush: false,
        });
      } catch {
        return;
      }
    },
  };
}
