import pino, { type Logger, type LoggerOptions } from "pino";

export type { Logger };
export type LogLevel = "error" | "warn" | "info" | "debug";

function options(
  level: LogLevel,
  base?: Record<string, unknown>,
): LoggerOptions {
  return {
    level,
    formatters: { level: (label: string) => ({ level: label }) },
    timestamp: pino.stdTimeFunctions.isoTime,
    base,
    redact: {
      paths: [
        "token",
        "*.token",
        "authorization",
        "*.authorization",
        "password",
        "*.password",
        "secret",
        "*.secret",
        "refreshToken",
        "*.refreshToken",
      ],
      censor: "[REDACTED]",
    },
  };
}

let instance: Logger = pino(options("info"));

export function configureLogger(opts: {
  level?: LogLevel;
  write?: (line: string) => void;
  base?: Record<string, unknown>;
}): void {
  const level = opts.level ?? (instance.level as LogLevel);
  instance = opts.write
    ? pino(options(level, opts.base), { write: opts.write })
    : pino(options(level, opts.base));
}

export function getLogger(): Logger {
  return instance;
}
