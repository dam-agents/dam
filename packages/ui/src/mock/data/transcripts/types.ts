import type { Message } from "../../../types.js";

export type StepKind = "in-chat" | "agent" | "outside-chat";

export interface TranscriptStep {
  id: string;
  label: string;
  kind: StepKind;
  messageEnd: number;
  firstMessageId?: string;
  pointer?: {
    target: string;
    exists: boolean;
  };
}

export interface TranscriptMeta {
  messages: Message[];
  steps: TranscriptStep[];
}
