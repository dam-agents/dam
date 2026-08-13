/** Inbound attachments the agent is handed as files rather than shown as
 *  pictures.
 *
 *  An attachment is one of two things to an agent. A picture it looks at rides
 *  the prompt as bytes, and only in the formats the model decodes — that is
 *  `inbound-image.ts`. Everything else is a file it opens: written into the
 *  agent's own workspace and referenced by absolute path, the same shape an
 *  upload from the web UI takes, because a harness reads a PDF or a transcript
 *  with the tools it reads any file with. There is no format list on this side:
 *  a list would silently swallow the next thing someone attaches, which is the
 *  failure this exists to end.
 *
 *  Which of the two an attachment is follows what the *sender* sent, not what
 *  the bytes turn out to be. A screenshot that arrives truncated is a failed
 *  picture, and naming the formats that work serves its sender better than
 *  quietly filing an image the harness can't open.
 */

/** What a messenger says about an attachment before anything is downloaded.
 *  Both fields are the uploading client's claim, so neither is trusted for
 *  more than deciding what to *attempt*. */
export interface InboundFileDescriptor {
  /** Filename as uploaded. Absent on some clients. */
  name?: string;
  /** The claimed type. Absent, or generic, on some clients. */
  mimeType?: string;
}

/** What a messenger sends when the uploading client didn't say: an image
 *  extension behind one of these is still worth a look. */
const GENERIC_MIME_TYPES = ["application/octet-stream", "binary/octet-stream"];

/** Whether the sender sent this as a picture — the fork between the two kinds
 *  of attachment. The label decides it where there is one, but a generic or
 *  absent label with an image extension counts too, rather than filing a real
 *  screenshot as a document on the strength of a bad label. */
export function wasSentAsImage(f: InboundFileDescriptor): boolean {
  if (f.mimeType?.startsWith("image/")) return true;
  if (f.mimeType && !GENERIC_MIME_TYPES.includes(f.mimeType)) return false;
  return /\.(png|jpe?g|gif|webp)$/i.test(f.name ?? "");
}

const MARKUP_MIME_TYPES = [
  "application/xml",
  "application/xhtml+xml",
  "application/json",
  "application/ld+json",
  "image/svg+xml",
];

const MARKUP_EXTENSIONS =
  /\.(html?|xhtml|xml|json|jsonl|svg|md|markdown|txt|text|csv|tsv|vtt|srt|log|ya?ml|rss|atom)$/i;

/** Whether markup in the bytes proves nothing about this file. A messenger
 *  that won't release a file answers with a 200 and a sign-in page, so HTML
 *  where a PDF was promised means the download failed — but HTML where an
 *  `.html` or a transcript was promised is just the file. Only the declared
 *  type can tell those apart, so it is what this reads. */
export function mayContainMarkup(f: InboundFileDescriptor): boolean {
  const mime = f.mimeType?.toLowerCase();
  if (mime?.startsWith("text/")) return true;
  if (mime && MARKUP_MIME_TYPES.includes(mime)) return true;
  return MARKUP_EXTENSIONS.test(f.name ?? "");
}

/** Ceiling for one delivered file, and for one message's files together.
 *
 *  Deliberately below the 50 MB a *web-UI* upload may be, and the reason is
 *  where the bytes travel rather than what a pod accepts: a browser uploads
 *  straight to the pod, while a messenger's attachment goes through the
 *  api-server, which holds the file and then hands the pod a base64 JSON body —
 *  several times the file's size, live at once, in a process whose default limit
 *  is 512Mi and which runs the channel workers for the whole install as a single
 *  replica. 20 MB covers the documents people actually share (a long PDF, a
 *  deck) while leaving that budget intact; a file above it is refused with its
 *  size named, rather than being delivered at the cost of the process. */
export const MAX_FILE_BYTES = 20 * 1_000_000;
export const TOTAL_FILE_BYTES_CAP = 20 * 1_000_000;

/** A page's own heading — where a served page says what it is. What a document
 *  merely *mentions* in its body says nothing (a runbook quoting "permission
 *  denied", a saved page linking to a workspace), so markers are read here
 *  rather than anywhere in the bytes. */
const HEADING =
  /<title[^>]*>([\s\S]{0,300}?)<\/title>|<h1[^>]*>([\s\S]{0,300}?)<\/h1>/g;

/** Said in a heading, each of these is the page refusing. */
const REFUSAL_HEADING =
  /\bsign[\s-]?in\b|\blog[\s-]?in\b|not authori[sz]ed|access denied|permission denied|forbidden|^\s*slack\s*$/;

/** A sign-in page the bytes are *pointed at* rather than one they merely link
 *  to: the target of a form or a meta refresh, which is what a redirect stub
 *  refusing a download looks like. A document may name the same URL in its
 *  prose, its `og:url` or its description — a saved page, a runbook, a `.md`
 *  linking to a workspace — and none of that says what these bytes are, so the
 *  marker is bound to the element that makes it a target rather than to the
 *  attribute alone. The host is matched whole (a subdomain, then `slack.com`)
 *  rather than as a substring, so neither an arbitrary prefix nor a lookalike
 *  host can stand in for it. */
/** Anchored, so the URL has to *be* this rather than contain it: an unanchored
 *  host pattern matches `https://evil.example/?next=https://slack.com/signin`,
 *  where the sign-in address is a parameter and the destination is someone
 *  else's. Subdomains are allowed; a lookalike host is not, since the label
 *  before `slack.com` must end at a dot. */
const SIGN_IN_URL =
  /^https?:\/\/(?:[a-z0-9-]+\.)*slack\.com\/(?:signin|workspace-signin)(?:[/?#]|$)/;

/** Each `form` and `meta` tag, judged on its own attributes. Matching an element
 *  and an attribute in one pattern makes the order they were written in
 *  significant, which in HTML it is not — a stub emitting `content` before
 *  `http-equiv` is the same stub. */
const TARGET_TAGS = /<(form|meta)\b[^>]*>/g;
const REFRESH = /http-equiv\s*=\s*["']?refresh/;
const ACTION = /\saction\s*=\s*["']?([^"'\s>]+)/;
const CONTENT = /\scontent\s*=\s*["']([^"']*)/;
/** The address out of a refresh directive (`0;url=…`). */
const REFRESH_URL = /url\s*=\s*(\S+)/;

function hasSignInTarget(head: string): boolean {
  for (const match of head.matchAll(TARGET_TAGS)) {
    const tag = match[0];
    if (match[1] === "form") {
      const action = ACTION.exec(tag);
      if (action?.[1] && SIGN_IN_URL.test(action[1])) return true;
      continue;
    }
    // `content` is where a meta tag carries prose — an og:url or a description
    // may name a sign-in page and still belong to a document — so it counts only
    // on the tag that makes it a destination, and only as that tag's own address.
    if (!REFRESH.test(tag)) continue;
    const content = CONTENT.exec(tag);
    const target = content?.[1] ? REFRESH_URL.exec(content[1]) : null;
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

/** Whether these bytes are the messenger refusing rather than the file. Checked
 *  even for formats whose contents may legitimately be markup: a `.csv` that is
 *  really a login screen would otherwise be written into the workspace and
 *  summarised as the sender's spreadsheet.
 *
 *  Deliberately conservative about *where* it reads. A genuine upload can say
 *  anything in its body — the two directions of this call are "the agent answers
 *  from a login screen" and "a real document is refused, blaming a permission
 *  that is granted" — so only a heading, a sign-in URL, or an actual password
 *  field counts. */
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

/** Workspace directory inbound attachments land under. Shared with the web
 *  UI's uploads, so a session that spans both surfaces keeps one place for
 *  the files people handed it. */
export const INBOUND_FILE_ROOT = ".uploads";

/** Strip a path segment down to something the agent's write surface accepts:
 *  no separators, no traversal, no leading dot to make a hidden file of it. */
function sanitizeSegment(s: string): string {
  return s.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^\.+/, "") || "file";
}

/** Where an inbound file lands: under `.uploads`, in a directory of its own
 *  conversation, behind a random prefix — the shape a web-UI upload takes.
 *  The prefix and the subdirectory are what stop an attachment from *being*
 *  something: in a shared channel anyone the messenger admits can attach a
 *  file, and a `CLAUDE.md` or an `.env` landing where the harness reads one
 *  would let a passer-by rewrite what the agent believes. They also let two
 *  files of the same name coexist in one thread.
 *
 *  What the per-conversation directory does *not* do is scope reading: one
 *  workspace serves every conversation an Agent is bound to, so a file sent in
 *  a private DM is on disk for a turn driven from a public channel to find.
 *  That is the workspace model, not a property of this path. */
export function inboundFilePath(opts: {
  /** The turn's conversation, as its own directory — a thread key, not a
   *  display name. Sanitized here; callers pass it raw. */
  conversation: string;
  name: string;
  /** Short random token, unique per delivered file. */
  unique: string;
}): string {
  const dir = sanitizeSegment(opts.conversation);
  const name = sanitizeSegment(opts.name || "file");
  return `${INBOUND_FILE_ROOT}/${dir}/${opts.unique}-${name}`;
}
