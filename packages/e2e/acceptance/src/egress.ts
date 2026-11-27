import type { Person } from "./people.js";
import type { EgressRequest } from "./drivers/driver.js";

/** UNIT_BOUNDARY_DESCRIPTION: reads "GET postman-echo.com/ip", or a URL with its method, as the request an approval names. */
export function requestOf(text: string): EgressRequest {
  const [method, target] = text.split(/\s+/, 2);
  const url = new URL(
    target!.startsWith("http") ? target! : `https://${target!}`,
  );
  return { method: method!, host: url.hostname, path: url.pathname };
}

/** UNIT_BOUNDARY_DESCRIPTION: splits a rule's pattern, "postman-echo.com/status/*", into its host and path pattern; a pattern without a path covers every path. */
export function ruleOf(pattern: string): { host: string; pathPattern: string } {
  const slash = pattern.indexOf("/");
  return slash < 0
    ? { host: pattern, pathPattern: "*" }
    : { host: pattern.slice(0, slash), pathPattern: pattern.slice(slash) };
}

/** UNIT_BOUNDARY_DESCRIPTION: the network approvals of an agent that wait for its owner's verdict, those for one request when it is named. */
export async function waitingApprovals(
  person: Person,
  agentId: string,
  request?: EgressRequest,
) {
  return (await person.api.approvals.listForInstance.query({ agentId })).filter(
    (a) =>
      a.status === "pending" &&
      a.payload.kind === "ext_authz" &&
      (request === undefined ||
        (a.payload.host === request.host &&
          a.payload.path === request.path &&
          a.payload.method === request.method)),
  );
}
