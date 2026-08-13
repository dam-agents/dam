/** Attachments the agent is handed as files rather than shown as pictures
 *  (`inbound-image.ts` covers those). No format list here, deliberately: one
 *  would swallow the next thing someone attaches. See channels.md, §Inbound. */

/** A messenger's claims about an attachment — the uploading client's, so trusted
 *  only for deciding what to attempt. */
export interface InboundFileDescriptor {
  /** Filename as uploaded. Absent on some clients. */
  name?: string;
  /** The claimed type. Absent, or generic, on some clients. */
  mimeType?: string;
}

/** Sent when the uploading client didn't say. */
const GENERIC_MIME_TYPES = ["application/octet-stream", "binary/octet-stream"];

/** Whether the sender sent this as a picture. A generic or absent label with an
 *  image extension counts, so a bad label does not file a screenshot as a file. */
export function wasSentAsImage(f: InboundFileDescriptor): boolean {
  if (f.mimeType?.startsWith("image/")) return true;
  if (f.mimeType && !GENERIC_MIME_TYPES.includes(f.mimeType)) return false;
  return /\.(png|jpe?g|gif|webp)$/i.test(f.name ?? "");
}

/** Per file, and per message. Below the web UI's 50 MB because these bytes cross
 *  the api-server (512Mi, one replica for the install) rather than going
 *  browser-to-pod. */
export const MAX_FILE_BYTES = 20 * 1_000_000;
export const TOTAL_FILE_BYTES_CAP = 20 * 1_000_000;

/** A page's own heading. What a document merely mentions in its body says
 *  nothing — a runbook can quote "permission denied". */
const HEADING =
  /<title[^>]*>([\s\S]{0,300}?)<\/title>|<h1[^>]*>([\s\S]{0,300}?)<\/h1>/g;

/** Said in a heading, each of these is the page refusing. */
const REFUSAL_HEADING =
  /\bsign[\s-]?in\b|\blog[\s-]?in\b|not authori[sz]ed|access denied|permission denied|forbidden|^\s*slack\s*$/;

/** Anchored, so a target has to *be* this rather than carry it as a parameter;
 *  subdomains pass, a lookalike host does not. */
const SIGN_IN_URL =
  /^https?:\/\/(?:[a-z0-9-]+\.)*slack\.com\/(?:signin|workspace-signin)(?:[/?#]|$)/;

/** One attribute, quoted or bare — quote-aware, so a `>` in a value cannot end
 *  the element early. */
const ATTRIBUTE = /([a-z-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;

/** The address out of a refresh directive (`0;url=…`). */
const REFRESH_URL = /url\s*=\s*(.+)$/;

/** `<form>` and `<meta>` elements with their attributes, so each is judged on
 *  its own — HTML attribute order is not significant. */
function* targetElements(
  head: string,
): Generator<{ tag: string; attributes: Map<string, string> }> {
  const open = /<(form|meta)\b/g;
  let found: RegExpExecArray | null;
  while ((found = open.exec(head))) {
    const attributes = new Map<string, string>();
    ATTRIBUTE.lastIndex = open.lastIndex;
    let cursor = open.lastIndex;
    for (
      let attribute: RegExpExecArray | null;
      (attribute = ATTRIBUTE.exec(head));
    ) {
      // Past the next unquoted `>` belongs to a later tag.
      if (head.slice(cursor, attribute.index).includes(">")) break;
      attributes.set(
        attribute[1]!,
        (attribute[2] ?? attribute[3] ?? attribute[4] ?? "").trim(),
      );
      cursor = ATTRIBUTE.lastIndex;
    }
    yield { tag: found[1]!, attributes };
    open.lastIndex = cursor;
  }
}

function hasSignInTarget(head: string): boolean {
  for (const { tag, attributes } of targetElements(head)) {
    if (tag === "form") {
      if (SIGN_IN_URL.test(attributes.get("action") ?? "")) return true;
      continue;
    }
    // `content` carries prose on other meta tags (og:url, description), so it
    // counts only on the one that makes it a destination.
    if (!/refresh/.test(attributes.get("http-equiv") ?? "")) continue;
    const target = REFRESH_URL.exec(attributes.get("content") ?? "");
    if (target?.[1] && SIGN_IN_URL.test(target[1].trim())) return true;
  }
  return false;
}

/** The field that makes a page a login form, whoever served it. */
const PASSWORD_FIELD = /(type|name|id)\s*=\s*["']?password/;

/** Auth-shaped API error codes. A JSON refusal carries one of these; a sample
 *  response someone meant to upload would not. */
const AUTH_ERROR_CODE =
  /"(not_allowed_token_type|invalid_auth|not_authed|missing_scope|no_permission|token_revoked|account_inactive|invalid_permissions|access_denied|unauthorized|forbidden)"/;

/** Whether these bytes are the messenger refusing rather than the file — a `.csv`
 *  that is really a login screen would otherwise be summarised as a spreadsheet.
 *  Only a heading, a target URL or a password field counts, since a genuine
 *  document may say anything in its body. */
export function looksLikeSignInPage(head: string): boolean {
  const lower = head.toLowerCase().trimStart();
  if (lower.startsWith("{")) return AUTH_ERROR_CODE.test(lower);
  if (!/^<(!doctype|html|head|body|meta|\?xml|!--)/.test(lower)) return false;
  if (hasSignInTarget(lower)) return true;
  for (const match of lower.matchAll(HEADING)) {
    const heading = (match[1] ?? match[2] ?? "").trim();
    if (REFUSAL_HEADING.test(heading)) return true;
  }
  return (
    /\bsign[\s-]?in\b|\blog[\s-]?in\b/.test(lower) && PASSWORD_FIELD.test(lower)
  );
}

/** Shared with the web UI's uploads, so both surfaces land in one place. */
export const INBOUND_FILE_ROOT = ".uploads";

/** No separators, no traversal, no leading dot. */
function sanitizeSegment(s: string): string {
  return s.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^\.+/, "") || "file";
}

/** The prefix and the per-conversation directory stop an attachment from *being*
 *  something: anyone a shared channel admits could otherwise land a `CLAUDE.md`
 *  where the harness reads one. Neither scopes *reading* — one workspace serves
 *  every conversation an Agent is bound to. */
export function inboundFilePath(opts: {
  /** A thread key, not a display name. Sanitized here. */
  conversation: string;
  name: string;
  /** Unique per delivered file. */
  unique: string;
}): string {
  const dir = sanitizeSegment(opts.conversation);
  const name = sanitizeSegment(opts.name || "file");
  return `${INBOUND_FILE_ROOT}/${dir}/${opts.unique}-${name}`;
}
