export interface RuntimeEnvReader {
  current(): Record<string, string>;
  ready(): boolean;
}

export const mergedSpawnEnv = (
  envReader: RuntimeEnvReader,
): NodeJS.ProcessEnv => ({ ...envReader.current(), ...process.env });
