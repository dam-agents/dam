import { parseAgentPostLink } from "./slack-post-delete.js";
import {
  matchRosterName,
  type RosterEntry,
  stripLeadingMentions,
} from "./slack-routing.js";

export type MentionCommand =
  { kind: "run"; text: string } | { kind: "slash-only"; verb: "delete" };

const MENTION_COMMAND_WORDS = new Set([
  "who",
  "bind",
  "unbind",
  "default",
  "ambient",
  "history",
  "ignore",
  "unignore",
  "delete",
  "login",
  "logout",
]);

const TRAILING_PUNCTUATION = /[?.!]+$/;

function mentionBody(text: string): string {
  return stripLeadingMentions(text).trim().replace(TRAILING_PUNCTUATION, "");
}

export function mentionCommandVerb(text: string): string | null {
  const body = mentionBody(text);
  if (!body) return "who";
  const verb = body.split(/\s+/)[0]!.toLowerCase();
  return MENTION_COMMAND_WORDS.has(verb) ? verb : null;
}

export function parseSwitchArgs(rest: string): {
  action: "on" | "off" | null;
  nameArg: string;
} {
  const words = rest.split(/\s+/).filter(Boolean);
  const tail = words.at(-1)?.toLowerCase();
  const action = tail === "on" || tail === "off" ? tail : null;
  return { action, nameArg: (action ? words.slice(0, -1) : words).join(" ") };
}

export async function parseMentionCommand(
  text: string,
  roster: RosterEntry[],
  ignoredAppNames: () => Promise<string[]>,
): Promise<MentionCommand | null> {
  const verb = mentionCommandVerb(text);
  if (!verb) return null;
  const words = mentionBody(text).split(/\s+/).filter(Boolean);
  const rest = words.slice(1).join(" ");
  const run = { kind: "run", text: [verb, rest].join(" ").trim() } as const;
  const namesAgent = (name: string) =>
    !name || matchRosterName(roster, name).matches.length > 0;
  const isLink = (arg: string) =>
    words.length === 2 && parseAgentPostLink(arg) !== null;

  switch (verb) {
    case "who":
    case "bind":
    case "login":
    case "logout":
      return rest ? null : run;
    case "unbind":
    case "default":
      return namesAgent(rest) ? run : null;
    case "ambient":
    case "history":
      return namesAgent(parseSwitchArgs(rest).nameArg) ? run : null;
    case "ignore":
      return !rest || isLink(rest) ? run : null;
    case "unignore": {
      if (!rest || isLink(rest)) return run;
      const wanted = rest.toLowerCase();
      const names = await ignoredAppNames();
      return names.some((name) => name.toLowerCase() === wanted) ? run : null;
    }
    case "delete":
      return parseAgentPostLink(words[1] ?? "")
        ? { kind: "slash-only", verb }
        : null;
    default:
      return null;
  }
}
