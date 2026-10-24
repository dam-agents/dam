import type { Command } from "commander";
import { isAvatarCharacter } from "api-server-api/avatar/svg";
import type { AgentService } from "../services/agent-service.js";
import type { AvatarUploader } from "../infrastructure/avatar-upload-client.js";
import {
  describeAvatarFlagError,
  parseAvatarFlags,
} from "../domain/agent-avatar.js";
import { exitOnServiceError } from "../../shared/trpc/print.js";
import {
  EXIT_INVALID_INPUT,
  EXIT_RUNTIME_FAILURE,
} from "../../shared/exit-codes.js";

export interface AvatarOpts {
  avatar?: string;
  avatarFile?: string;
  avatarDefault?: boolean;
}

export function addAvatarOptions(cmd: Command, verb: string): Command {
  return cmd
    .option(
      "--avatar <character-or-emoji>",
      `${verb} one of the built-in characters, or one emoji (see \`dam agent avatars\`)`,
    )
    .option(
      "--avatar-file <path>",
      "upload a JPG or PNG of at most 2 MB as the avatar; the server crops it to a square",
    )
    .option(
      "--avatar-default",
      "show the character picked from your identity and the agent's name",
    );
}

function invalid(message: string): never {
  process.stderr.write(`error: ${message}\n`);
  return process.exit(EXIT_INVALID_INPUT);
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: the avatar flags become the value for the
 * agent's `avatar` field under the web app picker's rules: a character only
 * once the Getting Started Checklist unlocked it, unless the agent already
 * shows it, and an emoji or an uploaded image only with the
 * `custom-avatars` feature on. `undefined` leaves the avatar alone and
 * `null` clears it, so the agent shows its default character again.
 */
export async function avatarFromFlagsOrExit(
  opts: AvatarOpts,
  deps: {
    agentService: AgentService;
    uploader: AvatarUploader;
    host: string;
    current?: string | null;
  },
): Promise<string | null | undefined> {
  const parsed = parseAvatarFlags(opts);
  if (!parsed.ok) invalid(describeAvatarFlagError(parsed.error));
  const choice = parsed.value;
  if (choice === undefined) return undefined;
  if (choice.kind === "default") return null;

  if (choice.kind === "value" && isAvatarCharacter(choice.avatar)) {
    if (choice.avatar === deps.current) return choice.avatar;
    const unlocked = await deps.agentService.unlockedCharacters();
    exitOnServiceError(unlocked, deps.host);
    if (!unlocked.value.includes(choice.avatar))
      invalid(
        `the \`${choice.avatar}\` avatar is still locked; finish a Getting Started task in the web app to unlock it\nhint: run \`dam agent avatars\` to see which are unlocked`,
      );
    return choice.avatar;
  }

  const custom = await deps.agentService.customAvatarsEnabled();
  exitOnServiceError(custom, deps.host);
  if (!custom.value)
    invalid(
      "an emoji or an uploaded avatar needs the custom avatars feature; turn it on in the web app's settings, under Features",
    );
  if (choice.kind === "value") return choice.avatar;

  const uploaded = await deps.uploader.upload(choice.path);
  if (uploaded.kind === "unreadable")
    invalid(`cannot read \`${choice.path}\`: ${uploaded.reason}`);
  if (uploaded.kind === "failed") {
    process.stderr.write(
      `error: the avatar upload failed: ${uploaded.reason}\n`,
    );
    process.exit(
      uploaded.status === 400 || uploaded.status === 413
        ? EXIT_INVALID_INPUT
        : EXIT_RUNTIME_FAILURE,
    );
  }
  return uploaded.avatar;
}
