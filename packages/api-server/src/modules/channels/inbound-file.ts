export interface InboundFileDescriptor {
  name?: string;
  mimeType?: string;
}

const GENERIC_MIME_TYPES = ["application/octet-stream", "binary/octet-stream"];

export function wasSentAsImage(f: InboundFileDescriptor): boolean {
  if (f.mimeType?.startsWith("image/")) return true;
  if (f.mimeType && !GENERIC_MIME_TYPES.includes(f.mimeType)) return false;
  return /\.(png|jpe?g|gif|webp)$/i.test(f.name ?? "");
}

export const MAX_FILE_BYTES = 20 * 1_000_000;
export const TOTAL_FILE_BYTES_CAP = 20 * 1_000_000;

const HEADING =
  /<title[^>]*>([\s\S]{0,300}?)<\/title>|<h1[^>]*>([\s\S]{0,300}?)<\/h1>/g;

const REFUSAL_HEADING =
  /\bsign[\s-]?in\b|\blog[\s-]?in\b|not authori[sz]ed|access denied|permission denied|forbidden|^\s*slack\s*$/;

const SIGN_IN_URL =
  /^https?:\/\/(?:[a-z0-9-]+\.)*slack\.com\/(?:signin|workspace-signin)(?:[/?#]|$)/;

const ATTRIBUTE = /([a-z-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;

const REFRESH_URL = /url\s*=\s*(.+)$/;

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
    if (!/refresh/.test(attributes.get("http-equiv") ?? "")) continue;
    const target = REFRESH_URL.exec(attributes.get("content") ?? "");
    if (target?.[1] && SIGN_IN_URL.test(target[1].trim())) return true;
  }
  return false;
}

const PASSWORD_FIELD = /(type|name|id)\s*=\s*["']?password/;

const AUTH_ERROR_CODE =
  /"(not_allowed_token_type|invalid_auth|not_authed|missing_scope|no_permission|token_revoked|account_inactive|invalid_permissions|access_denied|unauthorized|forbidden)"/;

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

export const INBOUND_FILE_ROOT = ".uploads";

function sanitizeSegment(s: string): string {
  return s.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^\.+/, "") || "file";
}

export function inboundFilePath(opts: {
  conversation: string;
  name: string;
  unique: string;
}): string {
  const dir = sanitizeSegment(opts.conversation);
  const name = sanitizeSegment(opts.name || "file");
  return `${INBOUND_FILE_ROOT}/${dir}/${opts.unique}-${name}`;
}
