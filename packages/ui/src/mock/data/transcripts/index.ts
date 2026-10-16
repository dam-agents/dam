export type { StepKind, TranscriptStep, TranscriptMeta } from "./types.js";
export { sliceTranscriptForStep, sliceTranscriptForPhase } from "./slice.js";
export { msg, form } from "./helpers.js";

export {
  artifactTranscript,
  longChatTranscript,
  diffsTranscript,
  defaultTranscript,
} from "./legacy.js";
export { codeReviewerTranscript } from "./code-reviewer.js";
export { personalAssistantTranscript } from "./personal-assistant.js";
export { qualityInspectorTranscript } from "./quality-inspector.js";
export { llmWikiTranscript } from "./llm-wiki.js";
export { plainWikiTranscript } from "./plain-wiki.js";
export { nousTranscript } from "./nous.js";
export { kSearchTranscript } from "./k-search.js";

import type { Message } from "../../../types.js";

import { useStore } from "../../../store.js";
import { MOCK_SESSION_IDS, mockSessions } from "../sessions.js";
import { codeReviewerTranscript } from "./code-reviewer.js";
import { kSearchTranscript } from "./k-search.js";
import {
  artifactTranscript,
  defaultTranscript,
  longChatTranscript,
} from "./legacy.js";
import { llmWikiTranscript } from "./llm-wiki.js";
import { nousTranscript } from "./nous.js";
import { personalAssistantTranscript } from "./personal-assistant.js";
import { plainWikiTranscript } from "./plain-wiki.js";
import { qualityInspectorTranscript } from "./quality-inspector.js";
import { sliceTranscriptForStep } from "./slice.js";
import type { TranscriptMeta } from "./types.js";

const KIT_TRANSCRIPTS: Record<string, () => TranscriptMeta> = {
  [MOCK_SESSION_IDS.kitCodeGuardian]: codeReviewerTranscript,
  [MOCK_SESSION_IDS.kitPersonalAssistant]: personalAssistantTranscript,
  [MOCK_SESSION_IDS.kitQualityInspector]: qualityInspectorTranscript,
  [MOCK_SESSION_IDS.kitLlmWiki]: llmWikiTranscript,
  [MOCK_SESSION_IDS.kitPlainWiki]: plainWikiTranscript,
  [MOCK_SESSION_IDS.kitNous]: nousTranscript,
  [MOCK_SESSION_IDS.kitKSearch]: kSearchTranscript,
};

export { KIT_TRANSCRIPTS };

export function mockTranscriptMeta(
  _agentId: string,
  sessionId: string,
): TranscriptMeta | null {
  const factory = KIT_TRANSCRIPTS[sessionId];
  return factory ? factory() : null;
}

export function mockTranscript(
  agentId: string,
  sessionId: string,
): Message[] {
  if (sessionId === MOCK_SESSION_IDS.artifact) {
    return artifactTranscript();
  }
  if (sessionId === MOCK_SESSION_IDS.longChat) {
    return longChatTranscript();
  }
  const meta = mockTranscriptMeta(agentId, sessionId);
  if (meta) {
    const step = useStore.getState().onboardingStep;
    return sliceTranscriptForStep(meta, step);
  }

  const list = (mockSessions[agentId] ?? []) as {
    sessionId: string;
    title?: string;
  }[];
  const title =
    list.find((s) => s.sessionId === sessionId)?.title ?? "this task";
  return defaultTranscript(agentId, sessionId, title);
}

export function mockReply(text: string): string {
  const trimmed = text.trim();
  const subject =
    trimmed.length > 60 ? `${trimmed.slice(0, 57).trimEnd()}…` : trimmed;
  return `Got it: "${subject}". This is a prototype, so I'm not running anything, but a real agent would pick this up in its workspace and report back here.`;
}
