export interface HostAuth {
  issuer: string;
  username: string;
  sub: string;
  cliClientId: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}

export function isWithinRefreshBuffer(
  host: HostAuth,
  now: Date,
  bufferSeconds: number,
): boolean {
  return now.getTime() + bufferSeconds * 1000 >= host.expiresAt.getTime();
}
