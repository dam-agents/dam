import {
  satelliteFileWrittenSchema,
  type SatelliteFileWritten,
} from "api-server-api";
import type { TokenProvider } from "../../auth/index.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: The two requests a file transfer between a
 * machine and an Agent's workspace is made of. The bytes ride their own request
 * — in the body of a POST the platform writes into the workspace, or in the
 * body of a GET it reads back — and never a Job's arguments or its 1 MiB
 * result, which is what keeps a file out of the Agent's context.
 *
 * A transfer is authorised by the Job it belongs to, so every request names the
 * Job's Satellite and its sequence and carries the worker's own serve key. The
 * platform decides where a received file lands; the machine only names it.
 */
export interface FileTransfer {
  send(input: {
    sequence: number;
    name: string;
    bytes: Buffer;
    signal: AbortSignal;
  }): Promise<SatelliteFileWritten>;
  receive(input: {
    sequence: number;
    path: string;
    signal: AbortSignal;
  }): Promise<Buffer>;
}

function tokenReason(error: {
  kind: string;
  host?: string;
  reason?: string;
}): string {
  if (error.kind === "not-logged-in")
    return `not signed in${error.host === undefined ? "" : ` to ${error.host}`} — run \`dam auth login\``;
  if (error.kind === "session-expired")
    return `the sign-in for ${error.host ?? "the platform"} expired — run \`dam auth login\``;
  return error.reason ?? error.kind;
}

async function failure(res: Response): Promise<Error> {
  const body = (await res.json().catch(() => ({}))) as {
    error?: string;
    message?: string;
  };
  return new Error(
    body.message ?? body.error ?? `the platform answered ${res.status}`,
  );
}

export function createFileTransfer(deps: {
  satellite: string;
  host: string;
  tokenProvider: TokenProvider;
  fetch?: typeof fetch;
}): FileTransfer {
  const request = deps.fetch ?? fetch;
  const base = `${deps.host.replace(/\/+$/, "")}/api/satellites/${encodeURIComponent(deps.satellite)}/jobs`;

  const auth = async (): Promise<Record<string, string>> => {
    const token = await deps.tokenProvider.getValidAccessToken(deps.host);
    if (!token.ok) throw new Error(tokenReason(token.error));
    return { authorization: `Bearer ${token.value}` };
  };

  return {
    async send({ sequence, name, bytes, signal }) {
      const res = await request(
        `${base}/${sequence}/file?name=${encodeURIComponent(name)}`,
        {
          method: "POST",
          headers: {
            ...(await auth()),
            "content-type": "application/octet-stream",
            "content-length": String(bytes.length),
          },
          body: new Uint8Array(bytes),
          signal,
        },
      );
      if (!res.ok) throw await failure(res);
      const written = satelliteFileWrittenSchema.safeParse(await res.json());
      if (!written.success)
        throw new Error("the platform did not say where the file landed");
      return written.data;
    },

    async receive({ sequence, path, signal }) {
      const res = await request(
        `${base}/${sequence}/file?path=${encodeURIComponent(path)}`,
        { headers: await auth(), signal },
      );
      if (!res.ok) throw await failure(res);
      return Buffer.from(await res.arrayBuffer());
    },
  };
}
