import type { Contribution } from "api-server-api";

export type EgressInject = Extract<Contribution, { kind: "egress-inject" }>;

export function encodeAccessToken(
  rawToken: string,
  encoding: EgressInject["encoding"],
): string {
  if (encoding === "basic-x-access-token") {
    return Buffer.from(`x-access-token:${rawToken}`, "utf8").toString("base64");
  }
  return rawToken;
}
