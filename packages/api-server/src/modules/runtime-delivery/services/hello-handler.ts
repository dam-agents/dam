import type {
  EventReportInput,
  HelloInput,
  HelloResult,
  RuntimeDeliveryService,
} from "api-server-api";
import type {
  AgentsRuntimeRepo,
  OutboxRepo,
  PendingEventRow,
} from "../infrastructure/outbox-repo.js";
import type { StateQueue } from "../infrastructure/state-queue.js";
import type { HarnessConfigSnapshotWriter } from "./snapshot-writer.js";
import { emit, EventType } from "../../../events.js";
import { advertisedKindsChanged } from "../domain/capability-filter.js";
import type { UnitOfWork } from "../../../core/unit-of-work.js";

export type EventOutcomeHandler = (
  event: PendingEventRow,
  input: EventReportInput,
) => Promise<void>;

export function createHelloHandler(deps: {
  outboxRepo: OutboxRepo;
  agentsRuntimeRepo: AgentsRuntimeRepo;
  snapshotWriter: HarnessConfigSnapshotWriter;
  queue: StateQueue;
  uow: UnitOfWork;
  resolveOwner: (agentId: string) => Promise<string | null>;
  eventOutcomeHandler?: (kind: string) => EventOutcomeHandler | undefined;
  log: (msg: string) => void;
}): RuntimeDeliveryService {
  return {
    async reportEvent(agentId, input): Promise<void> {
      const event = await deps.outboxRepo.ownedEvent(input.eventId, agentId);
      if (!event) {
        deps.log(
          `[runtime-report] ${agentId}: no event ${input.eventId} owned by this agent; dropping`,
        );
        return;
      }
      await deps.outboxRepo.recordEventOutcome(
        input.eventId,
        input.outcome === "ok" ? null : (input.detail ?? input.outcome),
      );
      const handler = deps.eventOutcomeHandler?.(event.kind);
      if (handler) await handler(event, input);
    },

    async hello(agentId: string, input: HelloInput): Promise<HelloResult> {
      const bumpedVersion = await deps.uow(async (tx) => {
        const { previousCapabilities } =
          await deps.agentsRuntimeRepo.upsertHello(
            {
              agentId,
              protocolVersion: input.protocolVersion,
              capabilities: input.capabilities,
              agentRuntimeVersion: input.agentRuntimeVersion,
            },
            tx,
          );
        if (!advertisedKindsChanged(previousCapabilities, input.capabilities)) {
          return null;
        }
        const existing = await deps.outboxRepo.getRow(agentId, tx);
        if (!existing) return null;
        return deps.outboxRepo.bumpVersion(agentId, tx);
      });

      const ownerSub = await deps.resolveOwner(agentId);
      if (ownerSub) {
        emit({ type: EventType.RuntimeHelloReceived, agentId, ownerSub });
      }

      if (input.harnessConfigCurrent) {
        try {
          await deps.snapshotWriter.merge(agentId, input.harnessConfigCurrent, {
            confirmed: true,
          });
        } catch (err) {
          deps.log(
            `[runtime-hello] ${agentId}: harness-config snapshot write failed: ${(err as Error).message}`,
          );
        }
      }

      if (bumpedVersion !== null) {
        deps.log(
          `[runtime-hello] ${agentId}: advertised kinds changed; desired version bumped to v${bumpedVersion} for re-delivery`,
        );
      }
      const desiredVersion =
        bumpedVersion ?? (await deps.outboxRepo.getRow(agentId))?.version;
      if (desiredVersion === undefined) return { events: [] };

      if (desiredVersion > (input.lastAppliedVersion ?? 0)) {
        await deps.queue.enqueue(agentId, { retryUntilReady: true });
      }
      return { events: [] };
    },
  };
}
