export interface TokenSuccessBody {
  kind: "success";
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
}

export type OAuthErrorCode =
  | "authorization_pending"
  | "slow_down"
  | "access_denied"
  | "expired_token"
  | "invalid_grant"
  | "invalid_request"
  | "invalid_client"
  | "unauthorized_client"
  | "unsupported_grant_type"
  | (string & {});

export interface TokenErrorBody {
  kind: "error";
  error: OAuthErrorCode;
  error_description?: string;
}

export type TokenEndpointResponse = TokenSuccessBody | TokenErrorBody;
