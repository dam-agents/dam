import { parseAgentPostLink } from "./slack-post-delete.js";
import {
  matchRosterName,
  type RosterEntry,
  routeMention,
  stripLeadingMentions,
} from "./slack-routing.js";

const TRAILING_PUNCTUATION = /[?.!]+$/;

function mentionBody(text: string): string {
  return stripLeadingMentions(text).trim().replace(TRAILING_PUNCTUATION, "");
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

/**
 * UNIT_BOUNDARY_DESCRIPTION: Tells whether a mention's words read as a `/dam`
 * command, and which one. A mention always reaches an Agent; this only decides
 * whether its sender also gets a private tip that names the slash form. A
 * mention that opens with a connected Agent's name addresses that Agent, so it
 * is never a command, and an everyday sentence that only starts with a command
 * word (`who owns this?`) is not one either.
 */
export async function mentionedCommand(
  text: string,
  roster: RosterEntry[],
  ignoredAppNames: () => Promise<string[]>,
): Promise<string | null> {
  const words = mentionBody(text).split(/\s+/).filter(Boolean);
  const verb = words[0]?.toLowerCase();
  if (!verb || routeMention(text, roster)?.addressedByName) return null;
  const rest = words.slice(1).join(" ");
  const namesAgent = (name: string) =>
    !name || matchRosterName(roster, name).matches.length > 0;
  const isLink = (arg: string) =>
    words.length === 2 && parseAgentPostLink(arg) !== null;
  const command = (valid: boolean) => (valid ? verb : null);

  switch (verb) {
    case "whisper":
      return verb;
    case "who":
    case "bind":
    case "login":
    case "logout":
      return command(!rest);
    case "unbind":
    case "default":
      return command(namesAgent(rest));
    case "ambient":
      return command(namesAgent(parseSwitchArgs(rest).nameArg));
    case "history": {
      const { action, nameArg } = parseSwitchArgs(rest);
      return command(action !== null && namesAgent(nameArg));
    }
    case "ignore":
      return command(!rest || isLink(rest));
    case "unignore": {
      if (!rest || isLink(rest)) return verb;
      const wanted = rest.toLowerCase();
      const names = await ignoredAppNames();
      return command(names.some((name) => name.toLowerCase() === wanted));
    }
    case "delete":
      return command(parseAgentPostLink(words[1] ?? "") !== null);
    default:
      return null;
  }
}
