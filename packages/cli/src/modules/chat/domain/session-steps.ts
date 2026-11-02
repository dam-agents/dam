import { toolNameOf, toolServerOf } from "agent-runtime-api";

export interface MessageStep {
  kind: "message";
  role: "user" | "agent";
  text: string;
  at: string | null;
  messageId?: string;
}

export interface ToolStep {
  kind: "tool";
  toolCallId: string;
  tool: string;
  summary: string;
  status: string;
  startedAt: string | null;
  endedAt: string | null;
  durationMs: number | null;
}

export type Step = MessageStep | ToolStep;

export interface StepChange {
  index: number;
  step: Step;
  added: boolean;
}

const FINISHED = new Set(["completed", "failed", "cancelled"]);

export function isFinished(step: ToolStep): boolean {
  return step.endedAt !== null || FINISHED.has(step.status);
}
const SUMMARY_FIELDS = [
  "command",
  "file_path",
  "path",
  "pattern",
  "url",
  "query",
  "description",
  "prompt",
] as const;

function objectOf(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringOf(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

function frameAt(params: Record<string, unknown>): string | null {
  return stringOf(objectOf(objectOf(params._meta)?.platform)?.at) ?? null;
}

function toolOf(update: Record<string, unknown>): string {
  const named = stringOf(
    objectOf(objectOf(update._meta)?.claudeCode)?.toolName,
  );
  if (named) return named;
  const title = stringOf(update.title);
  if (title && toolServerOf(title)) return toolNameOf(title);
  return stringOf(update.kind) ?? "tool";
}

function summaryOf(update: Record<string, unknown>): string | undefined {
  const input = objectOf(update.rawInput);
  for (const field of SUMMARY_FIELDS) {
    const value = input?.[field];
    if (Array.isArray(value) && value.every((v) => typeof v === "string"))
      return value.join(" ");
    const text = stringOf(value);
    if (text) return text;
  }
  return stringOf(update.title);
}

function durationOf(
  startedAt: string | null,
  endedAt: string | null,
): number | null {
  if (startedAt === null || endedAt === null) return null;
  const ms = Date.parse(endedAt) - Date.parse(startedAt);
  return Number.isFinite(ms) && ms >= 0 ? ms : null;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Reads a Session Transcript, frame by frame, into
 * the steps `dam session show` prints: the messages of the person and of the
 * agent, and each tool call with its tool, a one-line summary of its input,
 * its status and how long it took. Chunks of one message (one `messageId`, or
 * consecutive chunks of one role when the harness sends none) become one
 * message. A tool call's duration is the time between the `_meta.platform.at`
 * stamp of its `tool_call` frame and that of the update that finished it,
 * because no harness reports a duration of its own. A turn that ends by a
 * stop or an error sends no closing update for the calls still open, so
 * settle closes them as `cancelled` or `failed`, with an end time and no
 * duration, the way the web chat does. Thoughts and plans are not steps.
 */
export function createStepLog() {
  const steps: Step[] = [];
  const toolIndex = new Map<string, number>();

  function applyMessage(
    role: MessageStep["role"],
    update: Record<string, unknown>,
    at: string | null,
  ): StepChange | null {
    const text = stringOf(objectOf(update.content)?.text);
    if (text === undefined) return null;
    const messageId = stringOf(update.messageId);
    const last = steps.at(-1);
    if (
      last?.kind === "message" &&
      last.role === role &&
      last.messageId === messageId
    ) {
      last.text += text;
      return { index: steps.length - 1, step: last, added: false };
    }
    const step: MessageStep = {
      kind: "message",
      role,
      text,
      at,
      ...(messageId !== undefined && { messageId }),
    };
    steps.push(step);
    return { index: steps.length - 1, step, added: true };
  }

  function applyTool(
    update: Record<string, unknown>,
    at: string | null,
  ): StepChange | null {
    const toolCallId = stringOf(update.toolCallId);
    if (toolCallId === undefined) return null;
    const known = toolIndex.get(toolCallId);
    const status = stringOf(update.status);
    if (known === undefined) {
      if (update.sessionUpdate !== "tool_call") return null;
      const finished = status !== undefined && FINISHED.has(status);
      const step: ToolStep = {
        kind: "tool",
        toolCallId,
        tool: toolOf(update),
        summary: summaryOf(update) ?? "",
        status: status ?? "pending",
        startedAt: at,
        endedAt: finished ? at : null,
        durationMs: finished ? 0 : null,
      };
      steps.push(step);
      toolIndex.set(toolCallId, steps.length - 1);
      return { index: steps.length - 1, step, added: true };
    }
    const step = steps[known] as ToolStep;
    if (step.tool === "tool") step.tool = toolOf(update);
    step.summary = summaryOf(update) ?? step.summary;
    if (status !== undefined) step.status = status;
    if (step.endedAt === null && FINISHED.has(step.status)) {
      step.endedAt = at;
      step.durationMs = durationOf(step.startedAt, at);
    }
    return { index: known, step, added: false };
  }

  return {
    steps: steps as readonly Step[],
    settle(at: string | null, stopReason?: string): StepChange[] {
      const settled: StepChange[] = [];
      steps.forEach((step, index) => {
        if (step.kind !== "tool" || step.endedAt !== null) return;
        if (FINISHED.has(step.status)) return;
        step.status = stopReason === "cancelled" ? "cancelled" : "failed";
        step.endedAt = at;
        settled.push({ index, step, added: false });
      });
      return settled;
    },
    apply(params: unknown): StepChange | null {
      const p = objectOf(params);
      const update = objectOf(p?.update);
      if (p === null || update === null) return null;
      const at = frameAt(p);
      switch (update.sessionUpdate) {
        case "user_message_chunk":
          return applyMessage("user", update, at);
        case "agent_message_chunk":
          return applyMessage("agent", update, at);
        case "tool_call":
        case "tool_call_update":
          return applyTool(update, at);
        default:
          return null;
      }
    },
  };
}

export type StepLog = ReturnType<typeof createStepLog>;

export function elapsedMs(since: string, now: number): number | null {
  const ms = now - Date.parse(since);
  return Number.isFinite(ms) && ms >= 0 ? ms : null;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h${String(m).padStart(2, "0")}m`;
  if (m > 0) return `${m}m${String(s).padStart(2, "0")}s`;
  return `${s}s`;
}
