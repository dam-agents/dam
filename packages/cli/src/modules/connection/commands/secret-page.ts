import type {
  ConnectionAuthKind,
  ConnectionRequestSecretInput,
  CredentialCheck,
} from "api-server-api";
import type { BrowserOpener } from "../../auth/index.js";
import { EXIT_RUNTIME_FAILURE } from "../../shared/exit-codes.js";
import { exitOnServiceError } from "../../shared/trpc/print.js";
import type { ConnectionService } from "../services/connection-service.js";

const POLL_INTERVAL_MS = 2000;

export const PAGE_SECRET_FIELDS: Partial<
  Record<ConnectionAuthKind, readonly string[]>
> = {
  header: ["value"],
  "client-credentials": ["clientSecret"],
  "github-app": ["privateKey"],
  sigv4: ["accessKeyId", "secretAccessKey"],
};

export type SecretPageResult =
  | { kind: "saved"; connectionId: string; check?: CredentialCheck }
  | { kind: "unsupported" };

export async function enterSecretOnPage(args: {
  svc: ConnectionService;
  host: string;
  browserOpener: BrowserOpener;
  input: ConnectionRequestSecretInput;
  noBrowser: boolean;
  timeoutSeconds: number;
}): Promise<SecretPageResult> {
  const { svc, host } = args;
  const ticketRes = await svc.requestSecret(args.input);
  if (!ticketRes.ok && ticketRes.error.kind === "transport") {
    const code = ticketRes.error.serverCode;
    if (code === "NOT_FOUND" && /No procedure/i.test(ticketRes.error.reason)) {
      return { kind: "unsupported" };
    }
  }
  exitOnServiceError(ticketRes, host);
  const { requestId, url } = ticketRes.value;

  if (args.noBrowser) {
    process.stderr.write(`Open this link to enter the secret:\n  ${url}\n`);
  } else {
    const opened = await args.browserOpener.open(url);
    process.stderr.write(
      opened.ok
        ? `Opened a page to enter the secret:\n  ${url}\n`
        : `Couldn't open a browser. Open this link to enter the secret:\n  ${url}\n`,
    );
  }
  process.stderr.write(
    "Waiting for the secret… (sign in as the same user; the link works once)\n",
  );

  const deadline = Date.now() + args.timeoutSeconds * 1000;
  while (true) {
    const res = await svc.secretRequestStatus(requestId);
    exitOnServiceError(res, host);
    const state = res.value;
    switch (state.status) {
      case "saved":
        if (state.connectionId) {
          return {
            kind: "saved",
            connectionId: state.connectionId,
            ...(state.check ? { check: state.check } : {}),
          };
        }
        break;
      case "cancelled":
        process.stderr.write(
          "error: the secret was not entered — the page was cancelled\n",
        );
        process.exit(EXIT_RUNTIME_FAILURE);
      case "expired":
        process.stderr.write(
          "error: the link expired before the secret was entered — run the command again\n",
        );
        process.exit(EXIT_RUNTIME_FAILURE);
      case "pending":
        break;
    }
    if (Date.now() + POLL_INTERVAL_MS >= deadline) {
      process.stderr.write(
        `error: no secret was entered within ${args.timeoutSeconds}s; ` +
          "the link may still work — check `dam connection list`\n",
      );
      process.exit(EXIT_RUNTIME_FAILURE);
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
}
