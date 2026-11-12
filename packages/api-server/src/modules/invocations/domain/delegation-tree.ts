import type {
  DelegationAnswer,
  DelegationNode,
  InvocationHarnessConfig,
  InvocationStatus,
} from "api-server-api";

import { stoppedOf } from "./stop-reason.js";

export interface DelegationRecord {
  id: string;
  driverAgentId: string;
  label: string | null;
  prompt: string;
  script: string | null;
  exitCode: number | null;
  templateId: string | null;
  image: string | null;
  connections: string[];
  harnessConfig: InvocationHarnessConfig | null;
  status: InvocationStatus | "answered";
  errorReason: string | null;
  result: unknown;
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  transcriptCaptured: boolean;
  question: { text: string; options: string[]; defaultOption: string } | null;
  answerBy: Date | null;
  answer: (DelegationAnswer & { question: string }) | null;
}

// UNIT_BOUNDARY_DESCRIPTION: a run's state as its readers see it: a run whose question was answered is read through the run that continues it, so on its own it only shows for the moment between the two, as still going.
export const shownStatus = (
  status: DelegationRecord["status"],
): InvocationStatus => (status === "answered" ? "running" : status);

// UNIT_BOUNDARY_DESCRIPTION: the question a record waits on, as its owner reads it; only a run that is still asking has one.
export function questionOf(
  row: Pick<
    DelegationRecord,
    "status" | "question" | "answerBy" | "completedAt"
  >,
): DelegationNode["question"] {
  if (row.status !== "asking" || !row.question || !row.answerBy)
    return undefined;
  return {
    text: row.question.text,
    options: row.question.options,
    default: row.question.defaultOption,
    askedAt: (row.completedAt ?? row.answerBy).toISOString(),
    answerBy: row.answerBy.toISOString(),
  };
}

function toNode(
  row: DelegationRecord,
  children: DelegationNode[],
): DelegationNode {
  const question = questionOf(row);
  return {
    id: row.id,
    label: row.label,
    driverAgentId: row.driverAgentId,
    status: shownStatus(row.status),
    ...(question && { question }),
    ...(row.answer && {
      answer: {
        text: row.answer.text,
        by: row.answer.by,
        at: row.answer.at,
        answerBy: row.answer.answerBy,
      },
    }),
    errorReason: row.errorReason,
    stopped: row.status === "failed" ? stoppedOf(row.errorReason) : null,
    result: row.status === "done" ? row.result : null,
    prompt: row.prompt,
    script: row.script,
    exitCode: row.exitCode,
    templateId: row.templateId,
    image: row.image,
    connections: row.connections,
    requestedModel: row.harnessConfig?.model ?? null,
    createdAt: row.createdAt.toISOString(),
    started: row.startedAt !== null,
    completedAt: row.completedAt?.toISOString() ?? null,
    transcriptAvailable: row.transcriptCaptured,
    children,
  };
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: `rows` is one root driver's whole fan-out history;
 * the result is the subtree under each requested id, in request order, with ids
 * that are not in the set dropped rather than reported.
 */
export function buildDelegationTree(
  rows: readonly DelegationRecord[],
  ids: readonly string[],
): DelegationNode[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const childrenOf = new Map<string, DelegationRecord[]>();
  for (const row of rows) {
    const siblings = childrenOf.get(row.driverAgentId) ?? [];
    siblings.push(row);
    childrenOf.set(row.driverAgentId, siblings);
  }
  const seen = new Set<string>();
  function subtree(row: DelegationRecord): DelegationNode {
    seen.add(row.id);
    const kids = (childrenOf.get(row.id) ?? [])
      .filter((r) => !seen.has(r.id))
      .map(subtree);
    return toNode(row, kids);
  }
  const out: DelegationNode[] = [];
  for (const id of ids) {
    const row = byId.get(id);
    if (row && !seen.has(id)) out.push(subtree(row));
  }
  return out;
}
