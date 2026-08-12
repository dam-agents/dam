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
 *  Deliberately far below the 50 MB a *web-UI* upload may be: those bytes go
 *  from the browser straight to the pod, while a messenger's go through the
 *  api-server, which holds the file in memory and then hands the pod a
 *  base64 JSON body — several times the file's size, live at once, in a
 *  process whose default limit is 512Mi and which runs the channel workers for
 *  the whole install as a single replica. The cap that matters here is that
 *  budget, not what the pod would accept. */
export const MAX_FILE_BYTES = 8 * 1_000_000;
export const TOTAL_FILE_BYTES_CAP = 8 * 1_000_000;

/** Whether markup is the sign-in page a messenger serves in place of a file it
 *  won't release. Checked even for formats whose contents may legitimately be
 *  markup: a `.csv` that is really a login screen would otherwise be written
 *  into the workspace and summarised as the sender's spreadsheet. */
export function looksLikeSignInPage(head: string): boolean {
  const lower = head.toLowerCase();
  if (!/^<(!doctype|html|head|body)\b/.test(lower.trimStart())) return false;
  return (
    /sign\s?in|signin|log\s?in|<title>\s*slack\s*<\/title>|slack\.com/.test(
      lower,
    ) || /not authorized|permission|forbidden/.test(lower)
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
