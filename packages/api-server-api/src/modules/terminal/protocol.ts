export const OP_INPUT = 0x00;
export const OP_OUTPUT = 0x01;
export const OP_RESIZE = 0x02;
export const OP_EXIT = 0x03;

export type TerminalFrame =
  | { op: typeof OP_INPUT | typeof OP_OUTPUT; data: Uint8Array }
  | { op: typeof OP_RESIZE; cols: number; rows: number }
  | { op: typeof OP_EXIT; code: number };

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

export function encodeResize(cols: number, rows: number): Uint8Array {
  return new Uint8Array([
    OP_RESIZE,
    (cols >> 8) & 0xff,
    cols & 0xff,
    (rows >> 8) & 0xff,
    rows & 0xff,
  ]);
}

export function encodeExit(code: number): Uint8Array {
  return new Uint8Array([OP_EXIT, code & 0xff]);
}

export function decodeFrame(buf: Uint8Array): TerminalFrame {
  if (buf.byteLength === 0) throw new Error("empty terminal frame");
  const op = buf[0]!;
  const payload = buf.subarray(1);

  if (op === OP_INPUT || op === OP_OUTPUT) return { op, data: payload };
  if (op === OP_RESIZE) {
    if (payload.byteLength < 4) throw new Error("resize frame too short");
    return {
      op,
      cols: (payload[0]! << 8) | payload[1]!,
      rows: (payload[2]! << 8) | payload[3]!,
    };
  }
  if (op === OP_EXIT)
    return { op, code: payload.byteLength > 0 ? payload[0]! : 0 };
  throw new Error(
    `unknown terminal opcode: 0x${op.toString(16).padStart(2, "0")}`,
  );
}
