import { request } from "node:https";
import { z } from "zod";
import type {
  CredentialProbeOutcome,
  CredentialProbeTarget,
} from "../domain/credential-check.js";
import { isIpLiteral } from "../domain/kubernetes-contributions.js";
import { stripControlChars } from "./github-identity.js";

const SELF_SUBJECT_REVIEW_PATH =
  "/apis/authentication.k8s.io/v1/selfsubjectreviews";

const SELF_SUBJECT_REVIEW = JSON.stringify({
  apiVersion: "authentication.k8s.io/v1",
  kind: "SelfSubjectReview",
});

const MAX_BODY_BYTES = 64 * 1024;

const UNTRUSTED_CERT_CODES = new Set([
  "CERT_HAS_EXPIRED",
  "CERT_NOT_YET_VALID",
  "CERT_SIGNATURE_FAILURE",
  "CERT_UNTRUSTED",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_GET_ISSUER_CERT",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
]);

function isTlsErrorCode(code: string): boolean {
  return (
    code === "EPROTO" ||
    code.startsWith("ERR_TLS_") ||
    code.startsWith("ERR_SSL_") ||
    code.includes("CERT")
  );
}

const reviewSchema = z.object({
  status: z.object({
    userInfo: z.object({ username: z.string().min(1) }),
  }),
});

const claimsSchema = z.object({ exp: z.number().finite() });

class ProbeTimeout extends Error {}

function tokenExpiry(token: string): string | undefined {
  const payload = token.split(".")[1];
  if (!payload) return undefined;
  let claims: unknown;
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return undefined;
  }
  const parsed = claimsSchema.safeParse(claims);
  if (!parsed.success) return undefined;
  const at = new Date(parsed.data.exp * 1000);
  return Number.isNaN(at.getTime()) ? undefined : at.toISOString();
}

function postReview(
  target: CredentialProbeTarget,
  token: string,
  timeoutMs: number,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: target.host,
        port: target.port ?? 443,
        path: SELF_SUBJECT_REVIEW_PATH,
        agent: false,
        method: "POST",
        ...(isIpLiteral(target.host) ? {} : { servername: target.host }),
        ...(target.caPem ? { ca: target.caPem } : {}),
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          "Content-Type": "application/json",
          "User-Agent": "platform",
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size <= MAX_BODY_BYTES) chunks.push(chunk);
        });
        res.on("end", () =>
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString("utf8"),
          }),
        );
        res.on("error", reject);
      },
    );
    const deadline = setTimeout(
      () => req.destroy(new ProbeTimeout()),
      timeoutMs,
    );
    req.on("close", () => clearTimeout(deadline));
    req.on("error", reject);
    req.end(SELF_SUBJECT_REVIEW);
  });
}

function unreachable(
  err: unknown,
  target: CredentialProbeTarget,
): CredentialProbeOutcome {
  if (err instanceof ProbeTimeout) {
    return {
      status: "unchecked",
      reason: "the cluster's API server did not answer in time",
    };
  }
  const hasCa = !!target.caPem;
  const code = (err as { code?: unknown } | null)?.code;
  if (code === "ERR_TLS_CERT_ALTNAME_INVALID") {
    return {
      status: "failed",
      reason: `the cluster's certificate is not valid for ${target.host}`,
    };
  }
  if (typeof code === "string" && UNTRUSTED_CERT_CODES.has(code)) {
    return {
      status: "failed",
      reason: hasCa
        ? `the cluster's certificate does not match the CA given (${code})`
        : `the cluster's certificate is not publicly trusted (${code}); give the cluster's CA`,
    };
  }
  if (typeof code === "string" && isTlsErrorCode(code)) {
    return {
      status: "failed",
      reason: `the TLS connection to the cluster failed (${code})`,
    };
  }
  return {
    status: "unchecked",
    reason: "the cluster's API server could not be reached",
  };
}

// UNIT_BOUNDARY_DESCRIPTION: Checks a Kubernetes service-account token the way kubectl uses it: a SelfSubjectReview posted to the cluster's API server with the token and, when the Connection has one, the cluster's CA as the only trusted root. Any authenticated identity may create one, so it needs no permission beyond the token itself. A 200 or 201 passes and names the user the token acts as; the expiry comes from the token's own `exp` claim, as a ServiceAccount token is a JWT. A 401 fails, saying when the token expired if it has. A certificate the CA or the public roots do not trust fails, and so does any other TLS error, since kubectl would refuse them too. The timeout is a deadline for the whole request, not only for an idle socket. Any other answer, a timeout or a network error says nothing about the token and leaves it unchecked, with a fixed reason: an error's own text can carry the request, and the reason is stored and shown.
export async function probeKubernetesToken(
  target: CredentialProbeTarget,
  token: string,
  timeoutMs: number,
): Promise<CredentialProbeOutcome> {
  let res: { status: number; body: string };
  try {
    res = await postReview(target, token, timeoutMs);
  } catch (err) {
    return unreachable(err, target);
  }
  const expiresAt = tokenExpiry(token);
  if (res.status === 200 || res.status === 201) {
    let body: unknown = null;
    try {
      body = JSON.parse(res.body);
    } catch {
      body = null;
    }
    const review = reviewSchema.safeParse(body);
    return {
      status: "passed",
      ...(review.success
        ? { account: stripControlChars(review.data.status.userInfo.username) }
        : {}),
      ...(expiresAt ? { expiresAt } : {}),
    };
  }
  if (res.status === 401) {
    return {
      status: "failed",
      reason:
        expiresAt && Date.parse(expiresAt) <= Date.now()
          ? `the cluster refused the token, which expired ${expiresAt}`
          : "the cluster refused the token (HTTP 401)",
    };
  }
  if (res.status === 404) {
    return {
      status: "unchecked",
      reason:
        "the cluster does not offer SelfSubjectReview, which Kubernetes 1.28 added",
    };
  }
  return {
    status: "unchecked",
    reason: `the cluster answered HTTP ${res.status}, which says nothing about the token`,
  };
}
