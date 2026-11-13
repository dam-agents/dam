import { match } from "ts-pattern";
import type { SlackBlock, SlackMessageReplacement } from "./slack-gateway.js";

export const COMMAND_MENU = "command_menu";

export const MAX_AGENTS_SHOWN = 10;

const RUN_COMMAND_WORDS = new Set([
  "bind",
  "unbind",
  "default",
  "ambient",
  "history",
  "whisper",
  "unignore",
  "login",
  "logout",
  "help",
]);

const MAX_IGNORED_APPS_SHOWN = 10;

const SECTION_TEXT_MAX = 3000;

const BUTTON_LABEL_MAX = 75;

const OVERFLOW_VALUE_MAX = 150;

const HOME = "menu:home";

const CLOSE = "menu:close";

const IGNORED_APPS = "menu:ignored-apps";

const AGENT_SCREENS = [
  ["menu:whisper ", "whisper"],
  ["menu:disconnect ", "confirm-disconnect"],
  ["menu:delete ", "delete-help"],
] as const;

export interface CommandMenuAgent {
  name: string;
  role: string;
  ownerTag: string | null;
  isDefault: boolean;
  ambient: boolean;
  history: boolean;
  whispers: "on" | "off" | "unknown";
  mayManage: boolean;
  isOwner: boolean;
  sharesName: boolean;
}

export interface CommandMenuIgnoredApp {
  label: string;
  commandName: string;
}

export interface CommandMenuState {
  linked: boolean;
  agents: CommandMenuAgent[];
  hiddenAgents: number;
  ignoredApps: CommandMenuIgnoredApp[];
  mayChangeIgnoredApps: boolean;
}

export interface CommandMenuCopy {
  brandName: string;
  brandShort: string;
}

export type CommandMenuAction =
  | { kind: "home" }
  | { kind: "close" }
  | { kind: "ignored-apps" }
  | { kind: "whisper"; agentName: string }
  | { kind: "confirm-disconnect"; agentName: string }
  | { kind: "delete-help"; agentName: string }
  | { kind: "run"; command: string };

function section(text: string): SlackBlock {
  return {
    type: "section",
    text: { type: "mrkdwn", text: text.slice(0, SECTION_TEXT_MAX) },
  };
}

function context(text: string): SlackBlock {
  return { type: "context", elements: [{ type: "mrkdwn", text }] };
}

const DIVIDER: SlackBlock = { type: "divider" };

type MenuControl =
  | {
      kind: "button";
      label: string;
      value: string;
      style?: "primary" | "danger";
    }
  | { kind: "more"; items: { label: string; value: string }[] };

function controlRows(): (controls: MenuControl[]) => SlackBlock {
  let nextAction = 0;
  const plain = (text: string) => ({
    type: "plain_text",
    text: text.slice(0, BUTTON_LABEL_MAX),
  });
  return (controls) => ({
    type: "actions",
    elements: controls.map((control) => {
      const actionId = `${COMMAND_MENU}:${nextAction++}`;
      return match(control)
        .with({ kind: "button" }, (button) => ({
          type: "button",
          action_id: actionId,
          text: plain(button.label),
          value: button.value,
          ...(button.style ? { style: button.style } : {}),
        }))
        .with({ kind: "more" }, (more) => ({
          type: "overflow",
          action_id: actionId,
          options: more.items.map((item) => ({
            text: plain(item.label),
            value: item.value,
          })),
        }))
        .exhaustive();
    }),
  });
}

function more(items: { label: string; value: string }[]): MenuControl[] {
  const fitting = items.filter(
    (item) => item.value.length <= OVERFLOW_VALUE_MAX,
  );
  return fitting.length > 0 ? [{ kind: "more", items: fitting }] : [];
}

function onOff(on: boolean): string {
  return on ? "on" : "off";
}

function agentText(agent: CommandMenuAgent, copy: CommandMenuCopy): string {
  const mention = agent.isDefault
    ? `\`@${copy.brandName}\``
    : `\`@${copy.brandName} ${agent.name}\``;
  return [
    `\`${agent.name}\`${agent.isDefault ? " · *default*" : ""} · Send ${mention} to talk to this agent`,
    ...(agent.ownerTag ? [`Owned by ${agent.ownerTag}`] : []),
    ...(agent.role ? [`_${agent.role}_`] : []),
  ].join("\n");
}

function agentControls(agent: CommandMenuAgent): MenuControl[] {
  if (agent.sharesName) return [];
  const { name } = agent;
  return [
    ...(agent.whispers === "off"
      ? []
      : [
          {
            kind: "button" as const,
            label: "Whisper",
            value: `menu:whisper ${name}`,
          },
        ]),
    ...(agent.mayManage && !agent.isDefault
      ? [
          {
            kind: "button" as const,
            label: "Make default",
            value: `default ${name}`,
          },
        ]
      : []),
    ...more([
      ...(agent.mayManage
        ? [
            {
              label: `Join in when not tagged · ${onOff(agent.ambient)}`,
              value: `ambient ${name} ${onOff(!agent.ambient)}`,
            },
            {
              label: `Read past messages · ${onOff(agent.history)}`,
              value: `history ${name} ${onOff(!agent.history)}`,
            },
          ]
        : []),
      ...(agent.isOwner && agent.whispers !== "unknown"
        ? [
            {
              label: `Allow whispers · ${agent.whispers}`,
              value: `whisper ${name} ${onOff(agent.whispers === "off")}`,
            },
          ]
        : []),
      ...(agent.isOwner
        ? [{ label: "Delete one of its posts", value: `menu:delete ${name}` }]
        : []),
      ...(agent.mayManage
        ? [{ label: "Disconnect…", value: `menu:disconnect ${name}` }]
        : []),
    ]),
  ];
}

function footnote(state: CommandMenuState, copy: CommandMenuCopy): string {
  const everyAgentManaged = state.agents.every((agent) => agent.mayManage);
  return [
    ...(state.agents.length === 0 || everyAgentManaged
      ? []
      : [
          state.linked
            ? "You can change only the agents you own or connected."
            : "Log in, under ⋯, to change the agents you own or connected.",
        ]),
    `Type \`/${copy.brandShort} help\` to discover more actions.`,
  ].join(" ");
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: The private menu the bare slash command answers
 * with: an ephemeral message that lists the conversation's Agents and offers
 * the commands as buttons and as items under a "more" control. A control
 * carries the text of the command it stands for, so a click and the typed
 * command run the same code, and the command's reply then takes the menu's
 * place. Slack has no disabled control, so an action the person may not take
 * is left out. A "more" control holds five items and a message 50 blocks,
 * which is what limits what is listed.
 */
export function commandMenu(
  state: CommandMenuState,
  copy: CommandMenuCopy,
): SlackMessageReplacement {
  const row = controlRows();
  const blocks: SlackBlock[] = [
    section(
      state.agents.length === 0
        ? "*Agents in this channel*\nNo agent is connected to this conversation."
        : "*Agents in this channel*",
    ),
  ];
  for (const agent of state.agents) {
    blocks.push(DIVIDER, section(agentText(agent, copy)));
    const controls = agentControls(agent);
    if (controls.length > 0) blocks.push(row(controls));
    if (agent.sharesName)
      blocks.push(
        context(
          "Another agent here has the same name, so change this one in the platform UI.",
        ),
      );
  }
  if (state.hiddenAgents > 0)
    blocks.push(
      context(
        `${state.hiddenAgents} more agents are connected here. Run \`/${copy.brandShort} who\` to list them all.`,
      ),
    );
  blocks.push(
    DIVIDER,
    row([
      {
        kind: "button",
        label: "Add an agent",
        value: "bind",
        style: "primary",
      },
      { kind: "button", label: "Close", value: CLOSE },
      ...more([
        ...(state.agents.length > 0
          ? [{ label: "Ignored apps", value: IGNORED_APPS }]
          : []),
        { label: "All commands", value: "help" },
        state.linked
          ? { label: "Log out", value: "logout" }
          : { label: "Log in", value: "login" },
      ]),
    ]),
    context(footnote(state, copy)),
  );
  return { text: "Agents in this channel", blocks };
}

export function ignoredAppsMenu(
  state: CommandMenuState,
  copy: CommandMenuCopy,
): SlackMessageReplacement {
  const row = controlRows();
  const shown = state.ignoredApps.slice(0, MAX_IGNORED_APPS_SHOWN);
  const hidden = state.ignoredApps.length - shown.length;
  const back: MenuControl = { kind: "button", label: "Back", value: HOME };
  return {
    text: "Ignored apps",
    blocks: [
      section(
        "*Ignored apps*\n" +
          (shown.length === 0
            ? "The agents here hear every app and webhook."
            : `The agents here ignore posts from ${shown
                .map((app) => app.label)
                .join(", ")}.`),
      ),
      row([
        ...(state.mayChangeIgnoredApps
          ? shown.map((app): MenuControl => ({
              kind: "button",
              label: `Hear ${app.commandName} again`,
              value: `unignore ${app.commandName}`,
            }))
          : []),
        back,
      ]),
      context(
        [
          ...(hidden > 0
            ? [
                `${hidden} more are ignored. Run \`/${copy.brandShort} ignore\` to list them all.`,
              ]
            : []),
          ...(shown.length > 0 && !state.mayChangeIgnoredApps
            ? [
                "Only someone who connected an agent here, or owns one connected here, can change which apps are ignored.",
              ]
            : []),
          `To ignore an app or webhook, run \`/${copy.brandShort} ignore <link to one of its posts>\`.`,
        ].join(" "),
      ),
    ],
  };
}

export function confirmDisconnect(agentName: string): SlackMessageReplacement {
  const row = controlRows();
  return {
    text: `Disconnect ${agentName}?`,
    blocks: [
      section(
        `*Disconnect \`${agentName}\`?*\nIt stops answering in this conversation. Its sessions and its other conversations stay as they are.`,
      ),
      row([
        {
          kind: "button",
          label: "Disconnect",
          value: `unbind ${agentName}`,
          style: "danger",
        },
        { kind: "button", label: "Back", value: HOME },
      ]),
    ],
  };
}

function sectionSizedPieces(text: string): string[] {
  const pieces: string[] = [];
  let rest = text;
  while (rest.length > SECTION_TEXT_MAX) {
    const window = rest.slice(0, SECTION_TEXT_MAX);
    const lineEnd = window.lastIndexOf("\n");
    const cut = lineEnd > 0 ? lineEnd : SECTION_TEXT_MAX;
    pieces.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\n/, "");
  }
  return rest ? [...pieces, rest] : pieces;
}

export function commandMenuResult(text: string): SlackMessageReplacement {
  return { text, blocks: sectionSizedPieces(text).map(section) };
}

export function commandMenuNotice(text: string): SlackMessageReplacement {
  const row = controlRows();
  return {
    text,
    blocks: [
      section(text),
      row([
        { kind: "button", label: "Back to the menu", value: HOME },
        { kind: "button", label: "Close", value: CLOSE },
      ]),
    ],
  };
}

export function isCommandMenuAction(actionId: string): boolean {
  return actionId.startsWith(`${COMMAND_MENU}:`);
}

export function parseCommandMenuAction(
  value: string,
): CommandMenuAction | null {
  if (value === HOME) return { kind: "home" };
  if (value === CLOSE) return { kind: "close" };
  if (value === IGNORED_APPS) return { kind: "ignored-apps" };
  for (const [prefix, kind] of AGENT_SCREENS) {
    const agentName = value.startsWith(prefix)
      ? value.slice(prefix.length).trim()
      : "";
    if (agentName) return { kind, agentName };
  }
  const verb = value.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  return RUN_COMMAND_WORDS.has(verb) ? { kind: "run", command: value } : null;
}
