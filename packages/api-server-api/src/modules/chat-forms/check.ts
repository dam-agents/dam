import {
  buildConversation,
  forEachRenderedComponent,
  functionCalls,
  type RendererError,
  type SurfaceState,
} from "./conversation.js";
import type { ChatFormPreferences } from "./preferences.js";
import { regexPatternProblem } from "./regex-pattern.js";
import { hasA2uiBlock, splitA2uiBlocks } from "./split-blocks.js";

export interface ChatFormCheck {
  ok: boolean;
  surfaces: { surfaceId: string; created: boolean; lockComposer: boolean }[];
  problems: RendererError[];
}

function blockSources(reply: string): {
  sources: string[];
  problems: RendererError[];
} {
  if (!hasA2uiBlock(reply)) return { sources: [reply], problems: [] };
  const blocks = splitA2uiBlocks(reply).flatMap((segment) =>
    segment.kind === "a2ui" ? [segment] : [],
  );
  if (blocks.length === 0)
    return {
      sources: [],
      problems: [
        {
          code: "VALIDATION_FAILED",
          message:
            "The reply mentions <a2ui-json> but no block opens at the start of a line, so the chat shows it as text.",
        },
      ],
    };
  return {
    sources: blocks.map((block) => block.source),
    problems: blocks.flatMap((block, index) =>
      block.closed
        ? []
        : [
            {
              code: "VALIDATION_FAILED",
              message: `Block ${index} has no closing </a2ui-json> tag.`,
            },
          ],
    ),
  };
}

const TEXT_INPUTS = new Set(["TextField"]);
const CHOICE_INPUTS = new Set([
  "CheckBox",
  "ChoicePicker",
  "Slider",
  "DateTimeInput",
  "Switch",
]);
const RECOMMENDED = /\(recommended\)\s*$/i;

function preferenceProblems(
  surface: SurfaceState,
  preferences: ChatFormPreferences,
): RendererError[] {
  let textInputs = 0;
  let choiceInputs = 0;
  let eventButtons = 0;
  let recommendedLabels = 0;
  forEachRenderedComponent(surface, (component) => {
    if (TEXT_INPUTS.has(component.component)) textInputs += 1;
    if (CHOICE_INPUTS.has(component.component)) choiceInputs += 1;
    if (component.component === "Button" && "event" in component.action)
      eventButtons += 1;
    const labels = [
      "label" in component ? component.label : undefined,
      ...("options" in component ? component.options.map((o) => o.label) : []),
    ];
    for (const label of labels)
      if (typeof label === "string" && RECOMMENDED.test(label))
        recommendedLabels += 1;
  });
  const problems: string[] = [];
  if (
    preferences.forms === "input" &&
    textInputs + choiceInputs + eventButtons === 0
  )
    problems.push(
      `Surface "${surface.id}" only shows content, and the user wants forms only when you need an answer. Write it as text.`,
    );
  if (
    preferences.pacing === "one-at-a-time" &&
    (choiceInputs > 1 || textInputs > 1)
  )
    problems.push(
      `Surface "${surface.id}" asks ${textInputs + choiceInputs} things at once, and the user wants one question per form (one input, plus an optional text field for "Other"). Ask the first question, then update this surface with the next one after the answer.`,
    );
  if (preferences.recommend === "off" && recommendedLabels > 0)
    problems.push(
      `Surface "${surface.id}" marks options as recommended, and the user does not want recommendations. Remove the "(Recommended)" marks and leave the inputs empty.`,
    );
  if (!preferences.lockComposer && surface.lockComposer)
    problems.push(
      `Surface "${surface.id}" locks the chat input, and the user does not allow that. Remove lockComposer.`,
    );
  return problems.map((message) => ({
    code: "USER_PREFERENCE",
    surfaceId: surface.id,
    message,
  }));
}

function regexProblems(surface: SurfaceState): RendererError[] {
  const problems: RendererError[] = [];
  for (const component of surface.components.values())
    for (const call of functionCalls(component)) {
      const pattern = call.args?.pattern;
      if (call["@call"] !== "regex" || typeof pattern !== "string") continue;
      const problem = regexPatternProblem(pattern);
      if (problem)
        problems.push({
          code: "VALIDATION_FAILED",
          surfaceId: surface.id,
          path: `/components/${component.id}`,
          message: `Component "${component.id}" has a regex check whose pattern ${JSON.stringify(pattern)} the chat cannot run: ${problem}. A pattern compiles with no flags and no implicit anchors, has at most 256 characters and no nested quantifiers.`,
        });
    }
  return problems;
}

// UNIT_BOUNDARY_DESCRIPTION: validates a reply the way the web chat replays it, except that a surface the reply updates without creating is taken to come from an earlier reply, and agent function calls are checked but not run, though each literal regex pattern is compiled the way the chat's renderer compiles it; with the user's preferences it also reports the forms they asked the agent not to send.
export function checkChatForm(
  reply: string,
  preferences?: ChatFormPreferences,
): ChatFormCheck {
  const { sources, problems } = blockSources(reply);
  const { surfaces, blocks } = buildConversation(
    sources.map((source, index) => ({
      key: String(index),
      messageId: "check",
      source,
      closed: true,
    })),
    { callFunction: () => null, assumeEarlierSurfaces: true },
  );
  for (const block of blocks.values()) {
    problems.push(...block.errors);
    for (const call of block.functionCalls)
      if (call.response.error)
        problems.push({
          code: call.response.error.code,
          message: `callRendererFunction "${call.name}": ${call.response.error.message}`,
        });
  }
  for (const surface of surfaces.values())
    if (!surface.deleted) problems.push(...regexProblems(surface));
  if (preferences)
    for (const surface of surfaces.values())
      if (!surface.assumed && !surface.deleted)
        problems.push(...preferenceProblems(surface, preferences));
  return {
    ok: problems.length === 0,
    surfaces: [...surfaces.values()].map((surface) => ({
      surfaceId: surface.id,
      created: !surface.assumed,
      lockComposer: surface.lockComposer,
    })),
    problems,
  };
}
