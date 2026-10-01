import type { ToolChip } from "../../../types.js";

const AWAIT_TOOL = "await_invocations";
const INVOKE_TOOL = "invoke_agent";

interface AwaitResult {
  done?: unknown[];
  failed?: unknown[];
  running?: unknown[];
  unknown?: unknown[];
}

export function isAwaitInvocationsChip(chip: ToolChip): boolean {
  return chip.title.includes(AWAIT_TOOL);
}

export function isInvokeAgentChip(chip: ToolChip): boolean {
  return chip.title.includes(INVOKE_TOOL);
}

function parseResult(chip: ToolChip): AwaitResult | null {
  for (const block of chip.content ?? []) {
    try {
      const parsed: unknown = JSON.parse(block.text ?? "");
      if (parsed && typeof parsed === "object" && "running" in parsed)
        return parsed as AwaitResult;
    } catch {
      continue;
    }
  }
  return null;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

export function awaitChipTitle(chip: ToolChip): string {
  const result = parseResult(chip);
  if (!result) return "Waiting on invocations…";
  const counts = [
    ["done", result.done?.length ?? 0],
    ["failed", result.failed?.length ?? 0],
    ["running", result.running?.length ?? 0],
    ["unknown", result.unknown?.length ?? 0],
  ] as const;
  const total = counts.reduce((sum, [, n]) => sum + n, 0);
  const parts = counts.filter(([, n]) => n > 0).map(([k, n]) => `${n} ${k}`);
  return `Waited on ${plural(total, "invocation")} — ${parts.join(", ")}`;
}
