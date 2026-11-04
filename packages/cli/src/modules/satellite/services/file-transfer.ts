import { Readable } from "node:stream";
import {
  satelliteFileWrittenSchema,
  type SatelliteFileWritten,
} from "api-server-api";
import type { TokenProvider } from "../../auth/index.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: The two requests one file transfer is made of. The
 * bytes ride their own request — streamed into the platform, or streamed back
 * out of it — and never a Job's arguments or its 1 MiB result, which is what
 * keeps a file out of the Agent's context.
 *
 * A request names the Job it is serving and presents the token that Job's claim
 * was issued, and nothing else: the platform reads the direction and both paths
 * from the Job's own arguments, so a machine cannot ask for a file its Agent did
 * not ask for. The platform decides where a received file lands and answers with
 * that path, a size and a sha256.
 */
export interface FileTransfer {
  send(input: {
    sequence: number;
    token: string;
    bytes: Readable;
    declaredBytes: number;
    signal: AbortSignal;
  }): Promise<SatelliteFileWritten>;
  receive(input: {
    sequence: number;
    token: string;
    signal: AbortSignal;
  }): Promise<{ stream: Readable; size: number }>;
}

const REFUSALS: Record<string, string> = {
  no_running_job: "the job this transfer belongs to is no longer running",
  not_the_claimant: "this machine is not the claim that is running this job",
  wrong_direction: "this tool does not move files that way",
  transfer_too_large: "the file is over the transfer limit",
  not_found: "the agent's workspace has no such file",
  already_there: "the agent's workspace already has a file at that path",
  workspace_refused: "the agent's workspace refused the file",
  bad_source_path: "the job does not name one file this machine can send",
  bad_workspace_path: "the job does not name one workspace file",
};

function reasonFor(code: unknown): string {
  const key = typeof code === "string" ? code : "unknown";
  return REFUSALS[key] ?? `the platform refused the transfer (${key})`;
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
  return `the sign-in could not be used (${error.kind === "refresh-failed" ? "refresh failed" : error.kind})`;
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

  const refused = async (res: Response): Promise<Error> => {
    const body = (await res.json().catch(() => ({}))) as { error?: unknown };
    return new Error(reasonFor(body.error));
  };

  return {
    async send({ sequence, token, bytes, declaredBytes, signal }) {
      const res = await request(`${base}/${sequence}/file`, {
        method: "POST",
        headers: {
          ...(await auth()),
          "content-type": "application/octet-stream",
          "content-length": String(declaredBytes),
          "x-dam-claim": token,
        },
        body: Readable.toWeb(bytes) as ReadableStream<Uint8Array>,
        duplex: "half",
        signal,
      } as RequestInit & { duplex: "half" });
      if (!res.ok) throw await refused(res);
      const written = satelliteFileWrittenSchema.safeParse(await res.json());
      if (!written.success)
        throw new Error("the platform did not say where the file landed");
      return written.data;
    },

    async receive({ sequence, token, signal }) {
      const res = await request(`${base}/${sequence}/file`, {
        headers: { ...(await auth()), "x-dam-claim": token },
        signal,
      });
      if (!res.ok) throw await refused(res);
      if (res.body === null) throw new Error("the platform sent no file");
      return {
        stream: Readable.fromWeb(
          res.body as Parameters<typeof Readable.fromWeb>[0],
        ),
        size: Number(res.headers.get("content-length") ?? 0),
      };
    },
  };
}
