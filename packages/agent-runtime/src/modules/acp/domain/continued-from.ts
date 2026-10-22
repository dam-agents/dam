import type { PlatformContinuedFrom } from "api-server-api";

import { isNonNullObject } from "api-server-api";

const TAG = "continued-from";
const BLOCK = new RegExp(`<${TAG}(?:\\s[^>]*)?>[\\s\\S]*?</${TAG}>\\s*`, "g");

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function guardClose(text: string): string {
  return text.replaceAll(`</${TAG}>`, `</${TAG}\u200b>`);
}

export function continuedFromBlock(seed: PlatformContinuedFrom): string {
  return [
    `<${TAG} label="${escapeAttribute(seed.label)}">`,
    "This chat continues the work of a sub-agent that has finished. " +
      "Its task and its result follow; the user's message comes after this block.",
    `<prompt>\n${guardClose(seed.prompt)}\n</prompt>`,
    `<result>\n${guardClose(seed.result)}\n</result>`,
    `</${TAG}>`,
  ].join("\n");
}

export function stripContinuedFrom(text: string): string {
  return text.replace(BLOCK, "");
}

export function frameContinuedFrom(
  frame: object,
  seed: PlatformContinuedFrom,
): object {
  if (!isNonNullObject(frame)) return frame;
  const params = frame.params;
  if (!isNonNullObject(params) || !Array.isArray(params.prompt)) return frame;
  return {
    ...frame,
    params: {
      ...params,
      prompt: [
        { type: "text", text: continuedFromBlock(seed) },
        ...params.prompt,
      ],
    },
  };
}

function isBlock(block: unknown): boolean {
  return (
    isNonNullObject(block) &&
    block.type === "text" &&
    typeof block.text === "string" &&
    block.text.startsWith(`<${TAG}`)
  );
}

export function withoutContinuedFrom(prompt: readonly unknown[]): unknown[] {
  return prompt.filter((block) => !isBlock(block));
}

export function carriesContinuedFrom(frame: unknown): boolean {
  if (!isNonNullObject(frame) || !isNonNullObject(frame.params)) return false;
  const prompt = frame.params.prompt;
  return Array.isArray(prompt) && prompt.some(isBlock);
}
