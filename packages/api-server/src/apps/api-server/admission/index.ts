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
