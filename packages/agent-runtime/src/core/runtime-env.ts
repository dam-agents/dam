export interface RuntimeEnvReader {
  current(): Record<string, string>;
  ready(): boolean;
}

export interface LeaseEnvReader extends RuntimeEnvReader {
  providers(): string[];
  forLease(lease: {
    harness: string;
    provider: string | null;
  }): Record<string, string>;
}

export const mergedSpawnEnv = (
  envReader: RuntimeEnvReader,
): NodeJS.ProcessEnv => ({ ...envReader.current(), ...process.env });

export const leaseSpawnEnv = (
  envReader: LeaseEnvReader,
  lease: { harness: string; provider: string | null; model: string | null },
): NodeJS.ProcessEnv => ({
  ...envReader.forLease(lease),
  ...process.env,
  PLATFORM_HARNESS: lease.harness,
  ...(lease.provider !== null && { PLATFORM_PROVIDER: lease.provider }),
  ...(lease.model !== null && { PLATFORM_MODEL: lease.model }),
});
