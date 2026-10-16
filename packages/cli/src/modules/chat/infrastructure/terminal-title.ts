const ESC = 0x1b;
const BEL = 0x07;

/** XTWINOPS: push the window title on the terminal's stack, and pop it back. */
export const TITLE_SAVE = "\x1b[22;0t";
export const TITLE_RESTORE = "\x1b[23;0t";

/**
 * OSC 2 sets the window title. Control characters are dropped so a session id
 * or agent name cannot end the sequence early.
 */
export function setTitle(text: string): string {
  // eslint-disable-next-line no-control-regex
  return `\x1b]2;${text.replace(/[\x00-\x1f\x7f]/g, "")}\x07`;
}

/**
 * Drops the title-setting sequences (OSC 0 and OSC 2) from a byte stream and
 * passes everything else through unchanged. The remote harness sets its own
 * title, which would replace the one `dam chat` shows. A sequence can be
 * split across chunks, so an incomplete tail is held back until the next one.
 */
export function createTitleFilter(): (chunk: Uint8Array) => Buffer {
  let held = Buffer.alloc(0);
  let dropping = false;

  return (chunk) => {
    const buf = held.length
      ? Buffer.concat([held, chunk])
      : Buffer.from(chunk);
    held = Buffer.alloc(0);
    const out: Buffer[] = [];
    let start = 0;
    let i = 0;

    while (i < buf.length) {
      if (dropping) {
        if (buf[i] === BEL) {
          dropping = false;
          start = i + 1;
        } else if (buf[i] === ESC) {
          if (i + 1 >= buf.length) {
            held = buf.subarray(i);
            return Buffer.concat(out);
          }
          dropping = false;
          if (buf[i + 1] === 0x5c) {
            start = i + 2;
            i += 2;
          } else {
            // A bare ESC cancels the string and starts the next sequence.
            start = i;
          }
          continue;
        }
        i++;
        continue;
      }

      if (buf[i] !== ESC) {
        i++;
        continue;
      }
      const head = buf.subarray(i, i + 4);
      if (isPrefixOfTitle(head) && head.length < 4) {
        out.push(buf.subarray(start, i));
        held = buf.subarray(i);
        return Buffer.concat(out);
      }
      if (head.length === 4 && isPrefixOfTitle(head)) {
        out.push(buf.subarray(start, i));
        dropping = true;
        i += 4;
        continue;
      }
      i++;
    }

    if (!dropping) out.push(buf.subarray(start));
    return Buffer.concat(out);
  };
}

/** Whether `head` is `ESC ] 0 ;` or `ESC ] 2 ;`, or the start of one. */
function isPrefixOfTitle(head: Uint8Array): boolean {
  if (head[0] !== ESC) return false;
  if (head.length > 1 && head[1] !== 0x5d) return false;
  if (head.length > 2 && head[2] !== 0x30 && head[2] !== 0x32) return false;
  if (head.length > 3 && head[3] !== 0x3b) return false;
  return true;
}
