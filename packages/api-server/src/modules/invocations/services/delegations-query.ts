import { TRPCError } from "@trpc/server";
import {
  delegationTitle,
  type DelegationNode,
  type InvocationsQueryService,
  type OwnerQuestion,
  type OwnerQuestionNotice,
} from "api-server-api";

import {
  buildDelegationTree,
  questionOf,
  shownStatus,
} from "../domain/delegation-tree.js";
import { shownInSession } from "../domain/session-scope.js";
import type {
  InvocationRow,
  InvocationsRepository,
} from "../infrastructure/invocations-repository.js";
import type { DelegationFramesPort } from "./delegation-frames.js";

const DELEGATION_TREE_ROW_LIMIT = 2000;

/**
 * UNIT_BOUNDARY_DESCRIPTION: the owner's read of the delegations under a
 * driver. Every read resolves the driver's root and answers only for rows of
 * that root the owner holds; the tree reads the root's newest rows, so a
 * long-lived root that outgrows the limit loses its oldest delegations first.
 */
export function createDelegationsQuery(deps: {
  repo: InvocationsRepository;
  owner: string;
  frames: DelegationFramesPort;
  // UNIT_BOUNDARY_DESCRIPTION: which of the sub-agents named have a network rule that waits for the owner, so a tree shows one whose start is held for it as waiting, not as working.
  egressWaitingAmong?: (agentIds: readonly string[]) => Promise<Set<string>>;
}): InvocationsQueryService {
  async function rootOf(driverAgentId: string): Promise<string> {
    const driverRow = await deps.repo.get(driverAgentId);
    return driverRow?.rootDriverId ?? driverAgentId;
  }

  async function ownedRowsOfRoot(driverAgentId: string) {
    const root = await rootOf(driverAgentId);
    const rows = await deps.repo.listByRoot(root, DELEGATION_TREE_ROW_LIMIT);
    if (rows.length === DELEGATION_TREE_ROW_LIMIT) {
      process.stderr.write(
        `[invocations] delegation tree for ${root} hit the ${DELEGATION_TREE_ROW_LIMIT}-row limit\n`,
      );
    }
    return withAnyRunRunning(rows.filter((r) => r.owner === deps.owner));
  }

  // UNIT_BOUNDARY_DESCRIPTION: a row reads as running while any of its runs runs, not only its latest, since a kept target runs several at once; every read of the tree and of the kept sub-agents goes through here.
  async function withAnyRunRunning(
    rows: Awaited<ReturnType<InvocationsRepository["listByRoot"]>>,
  ) {
    const others = rows
      .filter((r) => r.reapedAt === null && r.status !== "running")
      .map((r) => r.id);
    const running = new Set(
      (await deps.repo.listRunningRunsOf(others)).map((r) => r.id),
    );
    return rows.map((r) =>
      running.has(r.id) ? { ...r, status: "running" as const } : r,
    );
  }

  async function withStartHolds(
    nodes: DelegationNode[],
  ): Promise<DelegationNode[]> {
    const unstarted = (list: readonly DelegationNode[]): string[] =>
      list.flatMap((node) => [
        ...(node.status === "running" && !node.started ? [node.id] : []),
        ...unstarted(node.children),
      ]);
    const ids = unstarted(nodes);
    if (ids.length === 0 || !deps.egressWaitingAmong) return nodes;
    const held = await deps.egressWaitingAmong(ids);
    const mark = (list: readonly DelegationNode[]): DelegationNode[] =>
      list.map((node) => ({
        ...node,
        ...(held.has(node.id) && !node.started && { waitingForOwner: true }),
        children: mark(node.children),
      }));
    return held.size > 0 ? mark(nodes) : nodes;
  }

  // UNIT_BOUNDARY_DESCRIPTION: each waiting question with the child of a driver it sits under, at any depth: that child's start names the driver's Session the question belongs to. A question whose chain does not reach the driver is left out.
  async function placed(
    asking: readonly InvocationRow[],
    driverOf: (row: InvocationRow) => string,
  ) {
    const trees = new Map<string, Map<string, string>>();
    const treeOf = async (root: string) => {
      const known = trees.get(root);
      if (known) return known;
      const tree = new Map(
        (await deps.repo.listTreeOfRoot(root)).map((r) => [
          r.id,
          r.driverAgentId,
        ]),
      );
      trees.set(root, tree);
      return tree;
    };
    const out: {
      row: InvocationRow;
      question: NonNullable<ReturnType<typeof questionOf>>;
      child: InvocationRow;
    }[] = [];
    for (const row of asking) {
      const question = questionOf(row);
      if (!question) continue;
      const driver = driverOf(row);
      const tree = await treeOf(row.rootDriverId);
      const seen = new Set<string>();
      let childId: string | undefined;
      for (
        let at: string | undefined = row.id;
        at !== undefined && !seen.has(at);
        at = tree.get(at)
      ) {
        if (tree.get(at) === driver) {
          childId = at;
          break;
        }
        seen.add(at);
      }
      if (childId === undefined) continue;
      const child = childId === row.id ? row : await deps.repo.get(childId);
      if (child) out.push({ row, question, child });
    }
    return out;
  }

  return {
    listTargets: () => deps.repo.listTargetsByOwner(deps.owner),

    async kept({ driverAgentId }) {
      const rows = await ownedRowsOfRoot(driverAgentId);
      const driverOf = new Map(rows.map((r) => [r.id, r.driverAgentId]));
      const kept = rows.filter(
        (r) => r.keepUntil !== null && r.reapedAt === null,
      );
      const listed = new Set(kept.map((r) => r.id));
      // UNIT_BOUNDARY_DESCRIPTION: the kept sub-agent a row sits under, walking up its drivers: the agent asked about gives null, a listed one gives itself, and a chain that never reaches the agent asked about is not under it.
      const parentOf = (row: {
        driverAgentId: string;
      }): string | null | undefined => {
        const seen = new Set<string>();
        let at: string | undefined = row.driverAgentId;
        while (at !== undefined && !seen.has(at)) {
          if (at === driverAgentId) return null;
          if (listed.has(at)) return at;
          seen.add(at);
          at = driverOf.get(at);
        }
        return undefined;
      };
      return {
        subAgents: kept
          .sort((x, y) => y.createdAt.getTime() - x.createdAt.getTime())
          .flatMap((r) => {
            const parentId = parentOf(r);
            return parentId === undefined
              ? []
              : [
                  {
                    id: r.id,
                    label: r.label,
                    status: shownStatus(r.status),
                    keepUntil: r.keepUntil!.toISOString(),
                    parentId,
                  },
                ];
          }),
      };
    },

    async tree({ driverAgentId, ids }) {
      const owned = await ownedRowsOfRoot(driverAgentId);
      return { nodes: await withStartHolds(buildDelegationTree(owned, ids)) };
    },

    async running({ driverAgentId, sessionId }) {
      const running = (await deps.repo.listRunningByDriver(driverAgentId))
        .filter(
          (r) =>
            r.owner === deps.owner &&
            (sessionId === undefined || shownInSession(r, sessionId)),
        )
        .map((r) => r.id);
      if (running.length === 0) return { nodes: [] };
      const owned = await ownedRowsOfRoot(driverAgentId);
      return {
        nodes: await withStartHolds(buildDelegationTree(owned, running)),
      };
    },

    // UNIT_BOUNDARY_DESCRIPTION: the questions sub-agents under this driver wait on, oldest first, for one of its chats to put to the owner: at any depth, and scoped to the chat by the child of the driver they sit under, as its running children are.
    async questions({ driverAgentId, sessionId }) {
      const root = await rootOf(driverAgentId);
      const asking = (await deps.repo.listAskingByRoot(root)).filter(
        (r) => r.owner === deps.owner,
      );
      const questions: OwnerQuestion[] = [];
      for (const { row, question, child } of await placed(
        asking,
        () => driverAgentId,
      )) {
        if (sessionId !== undefined && !shownInSession(child, sessionId))
          continue;
        questions.push({
          id: row.id,
          title: delegationTitle(row),
          ...question,
        });
      }
      return {
        questions: questions.sort(
          (a, b) => Date.parse(a.askedAt) - Date.parse(b.askedAt),
        ),
      };
    },

    async waitingForOwner() {
      const asking = await deps.repo.listAskingByOwner(deps.owner);
      return (await placed(asking, (row) => row.rootDriverId)).map(
        ({ row, question, child }): OwnerQuestionNotice => ({
          id: row.id,
          title: delegationTitle(row),
          text: question.text,
          askedAt: question.askedAt,
          answerBy: question.answerBy,
          agentId: row.rootDriverId,
          sessionId: child.driverSessionId,
        }),
      );
    },

    async transcript({ driverAgentId, id }) {
      const [row, root] = await Promise.all([
        deps.repo.get(id),
        rootOf(driverAgentId),
      ]);
      const owned =
        row !== null && row.owner === deps.owner && row.rootDriverId === root;
      const frames =
        owned && row.transcriptCaptured
          ? await deps.frames.readFromRoot(root, id)
          : null;
      if (row === null || frames === null) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `no conversation kept for ${id}`,
        });
      }
      return { frames, truncated: row.transcriptTruncated };
    },
  };
}
