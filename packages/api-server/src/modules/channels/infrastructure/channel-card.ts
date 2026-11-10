import { cardToFallbackText } from "@chat-adapter/shared";
import {
  type CardLimits,
  CardSpecError,
  standardComponentDefinitions,
  toCard,
} from "@json-render/chat";
import { nestedToFlat } from "@json-render/core";
import type { CardChild, CardElement } from "chat";
import { z } from "zod";
import type { ChannelCard } from "../services/worker-contract.js";

export const CARD_LIMITS = {
  tables: 1,
  charts: 2,
  fields: 10,
  tableRows: 100,
  tableColumns: 20,
  chartTitle: 50,
  chartLabel: 20,
  chartSeries: 12,
  chartPoints: 20,
} as const satisfies CardLimits;

export const LINK_BUTTONS_PER_ROW = 25;

export const TITLE_CHARS = 150;

export const FIELD_CHARS = 2000;

export const TABLE_CHARS = 10_000;

const INTERACTIVE_NAMES: Record<string, string> = {
  button: "button that sends a choice back",
  select: "select menu",
  radio_select: "set of radio buttons",
  text_input: "text input",
};

interface ComponentDefinition {
  props: z.ZodType;
  slots?: readonly string[];
  description?: string;
  example?: unknown;
}

const DEFINITIONS: Record<string, ComponentDefinition> =
  standardComponentDefinitions;

export interface CardComponent {
  name: string;
  description: string;
  children: boolean;
  inside?: string;
  props: Record<string, unknown>;
  example: { type: string; props: unknown };
}

function interactiveParts(children: readonly CardChild[]): string[] {
  return children.flatMap((child): string[] => {
    if (child.type === "actions")
      return child.children
        .filter((action) => action.type !== "link-button")
        .map((action) => action.type);
    if (child.type === "section") return interactiveParts(child.children);
    return child.type in INTERACTIVE_NAMES ? [child.type] : [];
  });
}

function crowdedRows(children: readonly CardChild[]): number[] {
  return children.flatMap((child): number[] => {
    if (child.type === "actions")
      return child.children.length > LINK_BUTTONS_PER_ROW
        ? [child.children.length]
        : [];
    if (child.type === "section") return crowdedRows(child.children);
    return [];
  });
}

function longFields(children: readonly CardChild[]): string[] {
  return children.flatMap((child): string[] => {
    if (child.type === "fields")
      return child.children
        .filter(
          (field) => `*${field.label}*\n${field.value}`.length > FIELD_CHARS,
        )
        .map((field) => field.label);
    if (child.type === "section") return longFields(child.children);
    return [];
  });
}

function longTables(children: readonly CardChild[]): number[] {
  return children.flatMap((child): number[] => {
    if (child.type === "table") {
      const chars = [...child.headers, ...child.rows.flat()].join("").length;
      return chars > TABLE_CHARS ? [chars] : [];
    }
    if (child.type === "section") return longTables(child.children);
    return [];
  });
}

function cardIssues(card: CardElement): string[] {
  return [
    ...longTables(card.children).map(
      (chars) =>
        `a Table holds ${chars} characters in its cells; Slack shows at most ${TABLE_CHARS} as a table`,
    ),
    ...((card.title?.length ?? 0) > TITLE_CHARS
      ? [
          `the card title holds ${card.title?.length} characters; Slack shows at most ${TITLE_CHARS}`,
        ]
      : []),
    ...longFields(card.children).map(
      (label) =>
        `the Field "${label}" holds more than ${FIELD_CHARS} characters, which Slack cuts; shorten it, or put the long part in a Text`,
    ),
    ...interactiveParts(card.children).map(
      (type) =>
        `the card holds a ${INTERACTIVE_NAMES[type] ?? type}, which needs a click to reach you, and a channel card cannot carry one yet: use a LinkButton, or ask in the text`,
    ),
    ...crowdedRows(card.children).map(
      (count) =>
        `an Actions element holds ${count} buttons; Slack shows at most ${LINK_BUTTONS_PER_ROW} in one row`,
    ),
  ];
}

export function buildChannelCard(
  tree: Record<string, unknown>,
): { card: ChannelCard } | { issues: string[] } {
  let card: CardElement;
  try {
    card = toCard(nestedToFlat(tree), { limits: CARD_LIMITS });
  } catch (err) {
    if (err instanceof CardSpecError) return { issues: err.issues };
    return { issues: [err instanceof Error ? err.message : String(err)] };
  }
  const issues = cardIssues(card);
  if (issues.length > 0) return { issues };
  return {
    card: { card, text: cardToFallbackText(card, { boldFormat: "**" }) },
  };
}

function exampleNode(name: string, definition: ComponentDefinition) {
  return { type: name, props: definition.example ?? {} };
}

function renderedAlone(
  name: string,
  definition: ComponentDefinition,
): { card: CardElement; inside?: string } | null {
  const containers = Object.entries(DEFINITIONS).filter(
    ([container, d]) => container !== "Card" && (d.slots?.length ?? 0) > 0,
  );
  const placements: (string | undefined)[] = [
    undefined,
    ...containers.map(([container]) => container),
  ];
  for (const inside of placements) {
    const node = exampleNode(name, definition);
    const child = inside
      ? { ...exampleNode(inside, DEFINITIONS[inside]), children: [node] }
      : node;
    try {
      const card = toCard(
        nestedToFlat({
          type: "Card",
          props: { title: "Example" },
          children: [child],
        }),
      );
      return inside ? { card, inside } : { card };
    } catch {
      continue;
    }
  }
  return null;
}

function propsSchema(props: z.ZodType): Record<string, unknown> {
  const { $schema: _dialect, ...schema } = z.toJSONSchema(props, {
    io: "input",
    unrepresentable: "any",
  });
  return schema;
}

let components: CardComponent[] | undefined;

export function cardComponents(): CardComponent[] {
  components ??= Object.entries(DEFINITIONS).flatMap(
    ([name, definition]): CardComponent[] => {
      const entry: CardComponent = {
        name,
        description: definition.description ?? "",
        children: (definition.slots?.length ?? 0) > 0,
        props: propsSchema(definition.props),
        example: exampleNode(name, definition),
      };
      if (name === "Card") return [entry];
      const rendered = renderedAlone(name, definition);
      if (!rendered || cardIssues(rendered.card).length > 0) return [];
      return [rendered.inside ? { ...entry, inside: rendered.inside } : entry];
    },
  );
  return components;
}
