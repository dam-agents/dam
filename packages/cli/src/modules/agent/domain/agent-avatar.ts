import { avatarSchema } from "api-server-api";
import { AVATAR_CHARACTERS, AVATAR_EMOJI_RE } from "api-server-api/avatar/svg";
import { err, ok, type Result } from "../../../result.js";

export type AvatarChoice =
  | { kind: "value"; avatar: string }
  | { kind: "file"; path: string }
  | { kind: "default" };

export type AvatarFlagError =
  { kind: "conflict" } | { kind: "unknown"; input: string };

/**
 * UNIT_BOUNDARY_DESCRIPTION: the avatar flags of `dam agent create` and
 * `update` name one avatar at most. `--avatar` takes what the web app's
 * picker stores: a character, one emoji (bare or as `emoji:<emoji>`), or an
 * uploaded image's `image:<id>` as `dam agent get --json` shows it.
 */
export function parseAvatarFlags(opts: {
  avatar?: string;
  avatarFile?: string;
  avatarDefault?: boolean;
}): Result<AvatarChoice | undefined, AvatarFlagError> {
  const given = [
    opts.avatar !== undefined,
    opts.avatarFile !== undefined,
    opts.avatarDefault === true,
  ].filter(Boolean).length;
  if (given > 1) return err({ kind: "conflict" });
  if (opts.avatarFile !== undefined)
    return ok({ kind: "file", path: opts.avatarFile });
  if (opts.avatarDefault) return ok({ kind: "default" });
  if (opts.avatar === undefined) return ok(undefined);
  const input = opts.avatar.trim();
  const candidate = AVATAR_EMOJI_RE.test(`emoji:${input}`)
    ? `emoji:${input}`
    : input;
  return avatarSchema.safeParse(candidate).success
    ? ok({ kind: "value", avatar: candidate })
    : err({ kind: "unknown", input: opts.avatar });
}

export function describeAvatarFlagError(e: AvatarFlagError): string {
  if (e.kind === "conflict")
    return "pass one of --avatar, --avatar-file and --avatar-default";
  return `unknown avatar \`${e.input}\`; pass a character (${AVATAR_CHARACTERS.join(", ")}) or one emoji\nhint: run \`dam agent avatars\` to list them`;
}

export function renderAvatar(avatar: string | null | undefined): string {
  return avatar ?? "<default>";
}
