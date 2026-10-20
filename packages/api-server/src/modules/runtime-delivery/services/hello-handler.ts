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
import type { StateBuilder } from "./state-builder.js";
import { emit, EventType } from "../../../events.js";
import {
  advertisedKindsChanged,
  deliveryCapabilities,
} from "../domain/capability-filter.js";
import type { UnitOfWork } from "../../../core/unit-of-work.js";

export type EventOutcomeHandler = (
  event: PendingEventRow,
  input: EventReportInput,
) => Promise<void>;

export function createHelloHandler(deps: {
  outboxRepo: OutboxRepo;
  agentsRuntimeRepo: AgentsRuntimeRepo;
  snapshotWriter: HarnessConfigSnapshotWriter;
  stateBuilder: StateBuilder;
  queue: StateQueue;
  uow: UnitOfWork;
  resolveOwner: (agentId: string) => Promise<string | null>;
  eventOutcomeHandler?: (kind: string) => EventOutcomeHandler | undefined;
  log: (msg: string) => void;
}): RuntimeDeliveryService {
  async function stateDrifted(
    agentId: string,
    input: HelloInput,
  ): Promise<boolean> {
    if (input.lastAppliedHash === undefined) return false;
    try {
      const { hash } = await deps.stateBuilder.build(
        agentId,
        deliveryCapabilities(input.capabilities),
      );
      return hash !== input.lastAppliedHash;
    } catch (err) {
      deps.log(
        `[runtime-hello] ${agentId}: drift check failed: ${(err as Error).message}`,
      );
      return false;
    }
  }

  return {
    async reportEvent(agentId, input): Promise<void> {
      const event = await deps.outboxRepo.claimEventReport(
        input.eventId,
        agentId,
        input.outcome === "ok" ? null : (input.detail ?? input.outcome),
      );
      if (!event) {
        deps.log(
          `[runtime-report] ${agentId}: event ${input.eventId} is not this agent's, or already reported; dropping`,
        );
        return;
      }
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

      if (input.harnessConfigCurrent || input.harnessConfigCurrentByHarness) {
        try {
          if (input.harnessConfigCurrent)
            await deps.snapshotWriter.merge(
              agentId,
              input.harnessConfigCurrent,
              { confirmed: true },
            );
          for (const [harness, current] of Object.entries(
            input.harnessConfigCurrentByHarness ?? {},
          ))
            await deps.snapshotWriter.merge(agentId, current, {
              confirmed: true,
              harness,
            });
        } catch (err) {
          deps.log(
            `[runtime-hello] ${agentId}: harness-config snapshot write failed: ${(err as Error).message}`,
          );
        }
      }

      const ownerSub = await deps.resolveOwner(agentId);
      if (ownerSub) {
        emit({ type: EventType.RuntimeHelloReceived, agentId, ownerSub });
      }

      if (bumpedVersion !== null) {
        deps.log(
          `[runtime-hello] ${agentId}: advertised kinds changed; desired version bumped to v${bumpedVersion} for re-delivery`,
        );
      }
      const row =
        bumpedVersion === null ? await deps.outboxRepo.getRow(agentId) : null;
      let desiredVersion = bumpedVersion ?? row?.version;
      if (desiredVersion === undefined) return { events: [] };
      if (
        row &&
        desiredVersion === input.lastAppliedVersion &&
        (await stateDrifted(agentId, input))
      ) {
        desiredVersion = await deps.outboxRepo.bumpVersion(agentId);
        deps.log(
          `[runtime-hello] ${agentId}: applied state differs from the state built now; desired version bumped to v${desiredVersion} for re-delivery`,
        );
      }

      if (desiredVersion > (input.lastAppliedVersion ?? 0)) {
        await deps.queue.enqueue(agentId, { retryUntilReady: true });
      }
      return { events: [] };
    },
  };
}
