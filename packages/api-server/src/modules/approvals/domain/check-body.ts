const decoder = new TextDecoder("utf-8", { fatal: true });

// UNIT_BOUNDARY_DESCRIPTION: the text of a request body the gateway sent with a check, or null when its bytes are not valid UTF-8. A gate that reads a body refuses one it cannot decode, since the upstream could still read it another way.
export function decodedUtf8(bytes: Uint8Array): string | null {
  try {
    return decoder.decode(bytes);
  } catch {
    return null;
  }
}
