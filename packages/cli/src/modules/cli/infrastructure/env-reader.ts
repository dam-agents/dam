export interface EnvReader {
  get(name: string): string | undefined;
}

export function createProcessEnvReader(): EnvReader {
  return {
    get: (name) => process.env[name],
  };
}
