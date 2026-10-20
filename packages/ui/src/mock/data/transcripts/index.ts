export { adaevolveTranscript } from "./adaevolve.js";
export { codeReviewerTranscript } from "./code-reviewer.js";
export { evoxTranscript } from "./evox.js";
export { gepaTranscript } from "./gepa.js";
export { form, msg } from "./helpers.js";
export { kSearchTranscript } from "./k-search.js";
export {
  artifactTranscript,
  defaultTranscript,
  diffsTranscript,
  longChatTranscript,
} from "./legacy.js";
export { llmWikiTranscript } from "./llm-wiki.js";
export { microManagerTranscript } from "./micro-manager.js";
export { nousTranscript } from "./nous.js";
export { openevolveTranscript } from "./openevolve.js";
export { personalAssistantTranscript } from "./personal-assistant.js";
export { plainWikiTranscript } from "./plain-wiki.js";
export { qualityAssuranceTranscript } from "./quality-assurance.js";
export { qualityInspectorTranscript } from "./quality-inspector.js";
export { shinkaevolveTranscript } from "./shinkaevolve.js";
export { sliceTranscriptForPhase, sliceTranscriptForStep } from "./slice.js";
export { softwareDeveloperTranscript } from "./software-developer.js";
export { spotlightsTranscript } from "./spotlights.js";
export type { StepKind, TranscriptMeta, TranscriptStep } from "./types.js";

import { useStore } from "../../../store.js";
import type { Message } from "../../../types.js";
import { MOCK_SESSION_IDS, mockSessions } from "../sessions.js";
import { adaevolveTranscript } from "./adaevolve.js";
import { codeReviewerTranscript } from "./code-reviewer.js";
import { evoxTranscript } from "./evox.js";
import { gepaTranscript } from "./gepa.js";
import { kSearchTranscript } from "./k-search.js";
import {
  artifactTranscript,
  defaultTranscript,
  longChatTranscript,
} from "./legacy.js";
import { llmWikiTranscript } from "./llm-wiki.js";
import { microManagerTranscript } from "./micro-manager.js";
import { nousTranscript } from "./nous.js";
import { openevolveTranscript } from "./openevolve.js";
import { personalAssistantTranscript } from "./personal-assistant.js";
import { plainWikiTranscript } from "./plain-wiki.js";
import { qualityAssuranceTranscript } from "./quality-assurance.js";
import { qualityInspectorTranscript } from "./quality-inspector.js";
import { shinkaevolveTranscript } from "./shinkaevolve.js";
import { sliceTranscriptForStep } from "./slice.js";
import { softwareDeveloperTranscript } from "./software-developer.js";
import { spotlightsTranscript } from "./spotlights.js";
import type { TranscriptMeta } from "./types.js";

const KIT_TRANSCRIPTS: Record<string, () => TranscriptMeta> = {
  [MOCK_SESSION_IDS.kitCodeGuardian]: codeReviewerTranscript,
  [MOCK_SESSION_IDS.kitSoftwareDeveloper]: softwareDeveloperTranscript,
  [MOCK_SESSION_IDS.kitQualityAssurance]: qualityAssuranceTranscript,
  [MOCK_SESSION_IDS.kitQualityInspector]: qualityInspectorTranscript,
  [MOCK_SESSION_IDS.kitPersonalAssistant]: personalAssistantTranscript,
  [MOCK_SESSION_IDS.kitMicroManager]: microManagerTranscript,
  [MOCK_SESSION_IDS.kitLlmWiki]: llmWikiTranscript,
  [MOCK_SESSION_IDS.kitPlainWiki]: plainWikiTranscript,
  [MOCK_SESSION_IDS.kitSpotlights]: spotlightsTranscript,
  [MOCK_SESSION_IDS.kitKSearch]: kSearchTranscript,
  [MOCK_SESSION_IDS.kitNous]: nousTranscript,
  [MOCK_SESSION_IDS.kitOpenEvolve]: openevolveTranscript,
  [MOCK_SESSION_IDS.kitShinkaEvolve]: shinkaevolveTranscript,
  [MOCK_SESSION_IDS.kitGEPA]: gepaTranscript,
  [MOCK_SESSION_IDS.kitAdaEvolve]: adaevolveTranscript,
  [MOCK_SESSION_IDS.kitEvoX]: evoxTranscript,
};

export { KIT_TRANSCRIPTS };

export function mockTranscriptMeta(
  _agentId: string,
  sessionId: string,
): TranscriptMeta | null {
  const factory = KIT_TRANSCRIPTS[sessionId];
  return factory ? factory() : null;
}

export function mockTranscript(agentId: string, sessionId: string): Message[] {
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
