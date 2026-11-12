import type { OwnerQuestion } from "api-server-api";
import { useCallback, useState } from "react";

import { useStore } from "../../../store.js";
import { useOwnerQuestions } from "../api/queries.js";

export const questionKey = (question: OwnerQuestion): string =>
  `${question.id}:${question.askedAt}`;

export interface OwnerQuestionQueue {
  current: OwnerQuestion | undefined;
  more: number;
  postponed: readonly OwnerQuestion[];
  later: () => void;
  resume: () => void;
  answered: () => void;
}

// UNIT_BOUNDARY_DESCRIPTION: the questions a chat puts to its owner, one at a time, oldest first: the one that takes the input now, how many more wait behind it, and the ones put off with Later. An answer sent here hides its question at once, before the next read drops it.
export function useOwnerQuestionQueue(
  driverAgentId: string | null,
  sessionId: string | null,
): OwnerQuestionQueue {
  const { data } = useOwnerQuestions(driverAgentId, sessionId);
  const postponedKeys = useStore((s) => s.postponedQuestions);
  const postponeQuestion = useStore((s) => s.postponeQuestion);
  const resumeQuestions = useStore((s) => s.resumeQuestions);
  const [sent, setSent] = useState<ReadonlySet<string>>(new Set());

  const open = (data?.questions ?? []).filter((q) => !sent.has(questionKey(q)));
  const active = open.filter((q) => !postponedKeys.has(questionKey(q)));
  const postponed = open.filter((q) => postponedKeys.has(questionKey(q)));
  const current = active[0];
  const currentKey = current ? questionKey(current) : null;

  const later = useCallback(() => {
    if (currentKey) postponeQuestion(currentKey);
  }, [currentKey, postponeQuestion]);

  const resume = useCallback(() => {
    resumeQuestions(postponed.map(questionKey));
  }, [postponed, resumeQuestions]);

  const answered = useCallback(() => {
    if (!currentKey) return;
    setSent((keys) => new Set([...keys, currentKey]));
  }, [currentKey]);

  return {
    current,
    more: Math.max(active.length - 1, 0),
    postponed,
    later,
    resume,
    answered,
  };
}
