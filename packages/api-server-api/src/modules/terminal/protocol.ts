/**
 * Binary WebSocket protocol for terminal relay.
 *
 * Every message is a binary frame whose first byte is an opcode tag.
 * Data-plane frames (INPUT/OUTPUT) carry raw terminal bytes with no
 * further framing — the opcode byte is the only overhead.
 *
 * This protocol is intentionally transport-agnostic: the same opcodes
 * work for browser WebSocket, Node.js ws, and a future CLI client.
 */

/** Client → server: keyboard / paste input. */
export const OP_INPUT = 0x00;
/** Server → client: PTY stdout. */
export const OP_OUTPUT = 0x01;
/** Client → server: terminal resize (4-byte payload: cols u16BE, rows u16BE). */
export const OP_RESIZE = 0x02;
/** Server → client: PTY process exited (1-byte payload: exit code). */
export const OP_EXIT = 0x03;

/** Decoded terminal frame. */
export type TerminalFrame =
  | { op: typeof OP_INPUT; data: Uint8Array }
  | { op: typeof OP_OUTPUT; data: Uint8Array }
  | { op: typeof OP_RESIZE; cols: number; rows: number }
  | { op: typeof OP_EXIT; code: number };

// ---------------------------------------------------------------------------
// Encoding helpers
// ---------------------------------------------------------------------------

/** Wrap raw data bytes in an INPUT or OUTPUT frame. */
export function encodeDataFrame(
  op: typeof OP_INPUT | typeof OP_OUTPUT,
  data: Uint8Array | string,
): Uint8Array {
  const payload =
    typeof data === "string" ? new TextEncoder().encode(data) : data;
  const frame = new Uint8Array(1 + payload.byteLength);
  frame[0] = op;
  frame.set(payload, 1);
  return frame;
}

/** Encode a resize frame. */
export function encodeResize(cols: number, rows: number): Uint8Array {
  const frame = new Uint8Array(5);
  frame[0] = OP_RESIZE;
  const view = new DataView(frame.buffer);
  view.setUint16(1, cols);
  view.setUint16(3, rows);
  return frame;
}

/** Encode an exit frame. */
export function encodeExit(code: number): Uint8Array {
  return new Uint8Array([OP_EXIT, code & 0xff]);
}

// ---------------------------------------------------------------------------
// Decoding
// ---------------------------------------------------------------------------

/** Decode a binary WebSocket message into a typed frame. */
export function decodeFrame(buf: Uint8Array): TerminalFrame {
  if (buf.byteLength === 0) {
    throw new Error("empty terminal frame");
  }
  const op = buf[0]!;
  const payload = buf.subarray(1);

  switch (op) {
    case OP_INPUT:
      return { op, data: payload };
    case OP_OUTPUT:
      return { op, data: payload };
    case OP_RESIZE: {
      if (payload.byteLength < 4)
        throw new Error("resize frame too short");
      const view = new DataView(
        payload.buffer,
        payload.byteOffset,
        payload.byteLength,
      );
      return { op, cols: view.getUint16(0), rows: view.getUint16(2) };
    }
    case OP_EXIT:
      return { op, code: payload.byteLength > 0 ? payload[0]! : 0 };
    default:
      throw new Error(`unknown terminal opcode: 0x${(op as number).toString(16).padStart(2, "0")}`);
  }
}
