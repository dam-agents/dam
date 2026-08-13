// Admission — "who are you, and may you use the platform", on any edge.
// Gates (auth.ts, terms.ts) classify and audit-log; middleware files are
// their HTTP edges; mappers.ts encodes denial kinds for the HTTP chain.
// Socket edges import the gates and encode through their own folders'
// mappers (trpc/mappers.ts, agent-proxies/mappers.ts).

export {
  authenticatePrincipal,
  clientIp,
  createAuth,
  emitUserAuthenticated,
  hasAgentBinding,
  hasScope,
  logWsAttach,
  upgradeSourceIp,
  AuthUnavailableError,
  ForbiddenError,
  UnauthorizedError,
  type Authenticate,
  type AuthConfig as AuthModuleConfig,
  type AuthDenialKind,
  type AuthSite,
  type SurfaceAttribution,
  type VerifiedPrincipal,
  type WsAuthSite,
} from "./auth.js";
export { createAuthMiddleware } from "./auth-middleware.js";
export { createTermsGate, isTermsOnlyTrpcCall } from "./terms-middleware.js";
export { checkWsTermsAccepted, type TermsDenialKind } from "./terms.js";
export { httpAuthDenial, httpTermsStale } from "./mappers.js";
export { startJwksWarmup } from "./jwks-warmup.js";
